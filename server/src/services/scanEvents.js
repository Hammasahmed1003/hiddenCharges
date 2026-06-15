const clients = new Map();

export function subscribeToScanEvents(userId, response) {
  const key = String(userId);
  const userClients = clients.get(key) || new Set();
  userClients.add(response);
  clients.set(key, userClients);

  response.writeHead(200, {
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream"
  });
  response.write("event: ready\ndata: {}\n\n");

  response.on("close", () => {
    userClients.delete(response);
    if (userClients.size === 0) clients.delete(key);
  });
}

export function emitScanEvent(userId, event, payload) {
  const userClients = clients.get(String(userId));
  if (!userClients) return;

  const message = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of userClients) {
    client.write(message);
  }
}
