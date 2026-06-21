import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logoPath = path.resolve(__dirname, "../../../client/public/hidden-logo-mark.png");
const COLORS = {
  ink: "#202123",
  muted: "#6F6F6F",
  faint: "#8F8F8F",
  line: "#E4E4E4",
  soft: "#F7F7F7",
  lime: "#B7FF5A",
  green: "#6EDB1B",
  white: "#FFFFFF"
};
const PAGE = { width: 595.28, height: 841.89, margin: 42 };
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

function formatDate(value) {
  if (!value) return "Unknown";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return `${String(date.getDate()).padStart(2, "0")}-${date.toLocaleDateString("en-US", {
    month: "long"
  })}-${date.getFullYear()}`;
}

function formatAmount(amount, currency) {
  return `${currency || ""} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: Number(amount) % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  }).format(Number(amount || 0))}`.trim();
}

function groupTotals(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    groups[key] = (groups[key] || 0) + Number(item.amount || 0);
    return groups;
  }, {});
}

function drawRoundedBox(doc, x, y, width, height, options = {}) {
  doc
    .save()
    .roundedRect(x, y, width, height, options.radius ?? 7)
    .fillAndStroke(options.fill || COLORS.white, options.stroke || COLORS.line)
    .restore();
}

function ensureSpace(doc, height, onNewPage) {
  if (doc.y + height <= PAGE.height - 58) return;
  doc.addPage();
  if (onNewPage) onNewPage();
}

function sectionTitle(doc, title, subtitle) {
  ensureSpace(doc, subtitle ? 54 : 34);
  doc.x = PAGE.margin;
  doc
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(title, PAGE.margin, doc.y, { width: CONTENT_WIDTH });
  if (subtitle) {
    doc
      .moveDown(0.2)
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(8.5)
      .text(subtitle, PAGE.margin, doc.y, { width: CONTENT_WIDTH });
  }
  doc.moveDown(0.7);
}

function drawHeader(doc, report) {
  if (fs.existsSync(logoPath)) {
    doc.image(logoPath, PAGE.margin, 38, { width: 34, height: 34 });
  } else {
    doc.save().roundedRect(PAGE.margin, 38, 34, 34, 8).fill(COLORS.lime).restore();
  }

  doc
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .fontSize(15)
    .text("HiddenCharges", PAGE.margin + 44, 42)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(8)
    .text("Financial visibility report", PAGE.margin + 44, 61);

  doc
    .roundedRect(PAGE.width - PAGE.margin - 72, 42, 72, 24, 12)
    .fill(COLORS.lime)
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("VERIFIED DATA", PAGE.width - PAGE.margin - 72, 50, { width: 72, align: "center" });

  doc
    .moveTo(PAGE.margin, 86)
    .lineTo(PAGE.width - PAGE.margin, 86)
    .strokeColor(COLORS.line)
    .lineWidth(1)
    .stroke();

  doc
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .fontSize(25)
    .text(report.title, PAGE.margin, 108, { width: CONTENT_WIDTH * 0.68 })
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(9)
    .text(report.subtitle, PAGE.margin, 143, { width: CONTENT_WIDTH * 0.72 });

  doc
    .fillColor(COLORS.faint)
    .fontSize(7.5)
    .text("REPORTING PERIOD", PAGE.width - PAGE.margin - 155, 110, { width: 155, align: "right" })
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(`${formatDate(report.startDate)} to`, PAGE.width - PAGE.margin - 155, 126, {
      width: 155,
      align: "right"
    })
    .text(formatDate(report.endDate), PAGE.width - PAGE.margin - 155, 140, {
      width: 155,
      align: "right"
    });

  doc.y = 185;
}

function drawMetricCards(doc, report) {
  const gap = 9;
  const width = (CONTENT_WIDTH - gap * 2) / 3;
  const baseY = doc.y;
  const cards = [
    ["VERIFIED PAYMENTS", String(report.items.filter((item) => item.paymentState !== "failed").length)],
    ["FAILED PAYMENTS", String(report.items.filter((item) => item.paymentState === "failed").length)],
    ["GMAIL ACCOUNTS", String(report.accounts.length)]
  ];

  cards.forEach(([label, value], index) => {
    const x = PAGE.margin + index * (width + gap);
    drawRoundedBox(doc, x, baseY, width, 62, { fill: COLORS.soft });
    doc
      .fillColor(COLORS.faint)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(label, x + 12, baseY + 12, { width: width - 24 })
      .fillColor(COLORS.ink)
      .fontSize(19)
      .text(value, x + 12, baseY + 29, { width: width - 24 });
  });
  doc.y = baseY + 80;
}

function drawCurrencyTotals(doc, report) {
  sectionTitle(
    doc,
    "Verified spend",
    "Original currencies remain separate so exchange-rate assumptions do not change the report."
  );

  const totals = Object.entries(groupTotals(report.items.filter((item) => item.paymentState !== "failed"), (item) => item.currency || "UNKNOWN"))
    .sort(([a], [b]) => a.localeCompare(b));

  if (totals.length === 0) {
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text("No verified spend in this period.");
    doc.moveDown(1.4);
    return;
  }

  const columns = Math.min(3, totals.length);
  const gap = 8;
  const width = (CONTENT_WIDTH - gap * (columns - 1)) / columns;
  const baseY = doc.y;
  totals.forEach(([currency, amount], index) => {
    const row = Math.floor(index / columns);
    const rowY = baseY + row * 58;
    const x = PAGE.margin + (index % columns) * (width + gap);
    drawRoundedBox(doc, x, rowY, width, 48, { fill: COLORS.white });
    doc
      .fillColor(COLORS.faint)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(currency, x + 11, rowY + 10)
      .fillColor(COLORS.ink)
      .fontSize(13)
      .text(formatAmount(amount, currency), x + 11, rowY + 24, { width: width - 22 });
  });
  doc.y = baseY + Math.ceil(totals.length / columns) * 58 + 10;
}

function drawSimpleTable(doc, { title, subtitle, rows, columns }) {
  sectionTitle(doc, title, subtitle);
  if (rows.length === 0) {
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text("No data for this section.");
    doc.moveDown(1.2);
    return;
  }

  const header = () => {
    const y = doc.y;
    doc.save().rect(PAGE.margin, y, CONTENT_WIDTH, 24).fill(COLORS.ink).restore();
    let x = PAGE.margin;
    columns.forEach((column) => {
      doc
        .fillColor(COLORS.white)
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(column.label.toUpperCase(), x + 7, y + 8, {
          width: column.width - 14,
          align: column.align || "left"
        });
      x += column.width;
    });
    doc.y = y + 24;
  };

  header();
  rows.forEach((row, index) => {
    ensureSpace(doc, 29, header);
    const y = doc.y;
    if (index % 2 === 1) doc.save().rect(PAGE.margin, y, CONTENT_WIDTH, 28).fill(COLORS.soft).restore();
    let x = PAGE.margin;
    columns.forEach((column) => {
      doc
        .fillColor(column.color?.(row) || COLORS.ink)
        .font(column.bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(8)
        .text(String(column.value(row) ?? ""), x + 7, y + 9, {
          width: column.width - 14,
          height: 11,
          align: column.align || "left",
          ellipsis: true,
          lineBreak: false
        });
      x += column.width;
    });
    doc.y = y + 28;
  });
  doc.moveDown(1.2);
}

function categoryRows(items) {
  const grouped = groupTotals(
    items.filter((item) => item.paymentState !== "failed"),
    (item) => `${item.category || "Other"}::${item.currency || "UNKNOWN"}`
  );
  return Object.entries(grouped)
    .map(([key, amount]) => {
      const [category, currency] = key.split("::");
      return { category, currency, amount };
    })
    .sort((a, b) => b.amount - a.amount);
}

function accountRows(items, accounts) {
  return accounts
    .map((account) => {
      const accountItems = items.filter(
        (item) => item.accountEmail === account.email && item.paymentState !== "failed"
      );
      const totals = groupTotals(accountItems, (item) => item.currency || "UNKNOWN");
      return {
        email: account.email,
        payments: accountItems.length,
        totals: Object.entries(totals)
          .map(([currency, amount]) => formatAmount(amount, currency))
          .join(" / ") || "No spend"
      };
    })
    .sort((a, b) => b.payments - a.payments);
}

function drawTransactions(doc, report) {
  const showAccount = report.accounts.length > 1;
  const columns = showAccount
    ? [
        { label: "Date", width: 78, value: (row) => formatDate(row.lastChargedAt) },
        { label: "Merchant", width: 125, value: (row) => row.merchantName, bold: true },
        { label: "Category", width: 75, value: (row) => row.category || "Other" },
        { label: "Account", width: 140, value: (row) => row.accountEmail },
        {
          label: "Amount",
          width: 93,
          value: (row) => row.paymentState === "failed" ? "Failed" : formatAmount(row.amount, row.currency),
          align: "right",
          bold: true,
          color: (row) => row.paymentState === "failed" ? "#B42318" : COLORS.ink
        }
      ]
    : [
        { label: "Date", width: 88, value: (row) => formatDate(row.lastChargedAt) },
        { label: "Merchant", width: 185, value: (row) => row.merchantName, bold: true },
        { label: "Category", width: 110, value: (row) => row.category || "Other" },
        {
          label: "Amount",
          width: 128,
          value: (row) => row.paymentState === "failed" ? "Failed" : formatAmount(row.amount, row.currency),
          align: "right",
          bold: true,
          color: (row) => row.paymentState === "failed" ? "#B42318" : COLORS.ink
        }
      ];

  drawSimpleTable(doc, {
    title: "Spending history",
    subtitle: "Every verified payment notification found within the reporting period.",
    rows: report.items,
    columns
  });
}

function drawAccuracyNote(doc, generatedAt) {
  ensureSpace(doc, 75);
  const baseY = doc.y;
  drawRoundedBox(doc, PAGE.margin, baseY, CONTENT_WIDTH, 58, {
    fill: "#F5FFE9",
    stroke: COLORS.lime
  });
  doc
    .fillColor(COLORS.ink)
    .font("Helvetica-Bold")
    .fontSize(8.5)
    .text("Accuracy note", PAGE.margin + 13, baseY + 11)
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(7.5)
    .text(
      "This Beta report is based on verified billing emails detected by HiddenCharges. Totals, categories, recurrence and dates should be reviewed against original receipts before financial decisions.",
      PAGE.margin + 13,
      baseY + 26,
      { width: CONTENT_WIDTH - 26, lineGap: 2 }
    );
  doc.y = baseY + 66;
  doc.fillColor(COLORS.faint).fontSize(7).text(`Generated ${formatDate(generatedAt)} by HiddenCharges.`);
  doc.y = baseY + 78;
}

function addFooters(doc) {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const originalBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .moveTo(PAGE.margin, PAGE.height - 34)
      .lineTo(PAGE.width - PAGE.margin, PAGE.height - 34)
      .strokeColor(COLORS.line)
      .lineWidth(0.7)
      .stroke()
      .fillColor(COLORS.faint)
      .font("Helvetica")
      .fontSize(7)
      .text("HiddenCharges - private financial visibility report", PAGE.margin, PAGE.height - 25, {
        width: CONTENT_WIDTH / 2,
        lineBreak: false
      })
      .text(`Page ${index + 1} of ${range.count}`, PAGE.width - PAGE.margin - 100, PAGE.height - 25, {
        width: 100,
        align: "right",
        lineBreak: false
      });
    doc.page.margins.bottom = originalBottomMargin;
  }
}

export function createFinancialReportPdf(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: PAGE.margin, right: PAGE.margin, bottom: 50, left: PAGE.margin },
      bufferPages: true,
      info: {
        Title: report.title,
        Author: "HiddenCharges",
        Subject: report.subtitle,
        Creator: "HiddenCharges"
      }
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    drawHeader(doc, report);
    drawMetricCards(doc, report);
    drawCurrencyTotals(doc, report);

    drawSimpleTable(doc, {
      title: "Category breakdown",
      subtitle: "Verified spending grouped by category and original currency.",
      rows: categoryRows(report.items),
      columns: [
        { label: "Category", width: 245, value: (row) => row.category, bold: true },
        { label: "Currency", width: 96, value: (row) => row.currency },
        {
          label: "Verified spend",
          width: 170,
          value: (row) => formatAmount(row.amount, row.currency),
          align: "right",
          bold: true
        }
      ]
    });

    if (report.accounts.length > 1) {
      drawSimpleTable(doc, {
        title: "Account summary",
        subtitle: "A combined view across connected Gmail accounts.",
        rows: accountRows(report.items, report.accounts),
        columns: [
          { label: "Gmail account", width: 260, value: (row) => row.email, bold: true },
          { label: "Payments", width: 85, value: (row) => row.payments, align: "right" },
          { label: "Verified spend", width: 166, value: (row) => row.totals, align: "right" }
        ]
      });
    }

    drawTransactions(doc, report);
    drawAccuracyNote(doc, report.generatedAt);
    addFooters(doc);
    doc.end();
  });
}

export { formatDate };
