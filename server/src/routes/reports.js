import express from "express";
import { listReportSubscriptions } from "../repositories/subscriptions.js";
import {
  accountBelongsToOwner,
  findOwnerIdForMember,
  findUserById,
  listAccountsForOwner
} from "../repositories/users.js";
import { createFinancialReportPdf } from "../services/pdfReport.js";
import { publicPlan } from "../services/plans.js";

const router = express.Router();

function requireUser(request, response, next) {
  if (!request.session.userId) {
    return response.status(401).json({ message: "Connect Gmail before generating reports" });
  }
  next();
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function reportRange(query, now = new Date()) {
  if (query.period === "year") {
    const year = Number(query.year || now.getFullYear());
    if (!Number.isInteger(year) || year < 2020 || year > now.getFullYear()) {
      throw new Error("Choose a valid report year");
    }
    const startDate = new Date(year, 0, 1, 0, 0, 0, 0);
    const naturalEnd = new Date(year, 11, 31, 23, 59, 59, 999);
    return {
      type: "year",
      label: `${year} year-to-date`,
      filenamePart: `${year}-year-to-date`,
      startDate,
      endDate: year === now.getFullYear() ? endOfDay(now) : naturalEnd
    };
  }

  const monthValue = String(query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`);
  const match = monthValue.match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error("Choose a valid report month");
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const startDate = new Date(year, monthIndex, 1, 0, 0, 0, 0);
  const naturalEnd = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  if (monthIndex < 0 || monthIndex > 11 || startDate > endOfDay(now)) {
    throw new Error("Choose a current or past report month");
  }
  const isCurrentMonth = year === now.getFullYear() && monthIndex === now.getMonth();
  const monthLabel = startDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return {
    type: "month",
    label: isCurrentMonth ? `${monthLabel} month-to-date` : monthLabel,
    filenamePart: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
    startDate,
    endDate: isCurrentMonth ? endOfDay(now) : naturalEnd
  };
}

async function reportContext(request) {
  const activeUserId = request.session.userId;
  const ownerUserId = request.session.ownerUserId || (await findOwnerIdForMember(activeUserId)) || activeUserId;
  const owner = await findUserById(ownerUserId);
  const plan = publicPlan({
    plan: owner?.plan,
    status: owner?.planStatus,
    currentPeriodEndsAt: owner?.currentPeriodEndsAt
  });
  const accounts = await listAccountsForOwner(ownerUserId, activeUserId);
  const scope = request.query.scope === "all" ? "all" : "account";

  if (scope === "all") {
    if (plan.id === "free") {
      const error = new Error("Combined Gmail reports are available on Pro and Max");
      error.statusCode = 403;
      throw error;
    }
    return { plan, accounts, selectedAccounts: accounts, ownerUserId, activeUserId, scope };
  }

  const requestedAccountId = Number(request.query.accountId || activeUserId);
  if (!(await accountBelongsToOwner(ownerUserId, requestedAccountId))) {
    const error = new Error("This Gmail account is not connected to your workspace");
    error.statusCode = 403;
    throw error;
  }
  const selectedAccount = accounts.find((account) => String(account.id) === String(requestedAccountId));
  return {
    plan,
    accounts,
    selectedAccounts: selectedAccount ? [selectedAccount] : [],
    ownerUserId,
    activeUserId,
    scope
  };
}

router.get("/pdf", requireUser, async (request, response, next) => {
  try {
    const range = reportRange(request.query);
    const context = await reportContext(request);
    const items = await listReportSubscriptions({
      userIds: context.selectedAccounts.map((account) => account.id),
      startDate: range.startDate,
      endDate: range.endDate
    });
    const accountLabel =
      context.scope === "all"
        ? `All connected Gmail accounts (${context.selectedAccounts.length})`
        : context.selectedAccounts[0]?.email || "Connected Gmail";
    const title = range.type === "year" ? "Annual financial report" : "Monthly financial report";
    const pdf = await createFinancialReportPdf({
      title,
      subtitle: `${range.label} - ${accountLabel}`,
      startDate: range.startDate,
      endDate: range.endDate,
      generatedAt: new Date(),
      items,
      accounts: context.selectedAccounts,
      plan: context.plan
    });
    const scopePart = context.scope === "all" ? "all-accounts" : "gmail-account";
    const filename = `hiddencharges-${range.filenamePart}-${scopePart}.pdf`;
    const disposition = request.query.mode === "inline" ? "inline" : "attachment";

    response.setHeader("Content-Type", "application/pdf");
    response.setHeader("Content-Length", pdf.length);
    response.setHeader("Content-Disposition", `${disposition}; filename=\"${filename}\"`);
    response.setHeader("Cache-Control", "private, no-store");
    response.send(pdf);
  } catch (error) {
    if (error.statusCode) return response.status(error.statusCode).json({ message: error.message });
    if (/Choose a/.test(error.message)) return response.status(400).json({ message: error.message });
    next(error);
  }
});

export default router;
