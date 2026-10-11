import { ReplitConnectors } from "@replit/connectors-sdk";

export interface AlertEmail { id: string; recipient: string; factoryName: string; title: string; message: string; actorName: string; createdAt: string }
export class EmailFailure extends Error {
  constructor(public code: string, public uncertain = false, public retryable = false) { super(code); }
}
async function bounded<T>(promise: Promise<T>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("TIMEOUT")), 30000); })]); }
  finally { clearTimeout(timer); }
}
export function encodeAlertEmail(email: AlertEmail, sender: string) {
  const subject = `=?UTF-8?B?${Buffer.from(`[NexusFab] ${email.factoryName}: ${email.title}`).toString("base64")}?=`;
  const body = `${email.factoryName}\n${email.title}\n\n${email.message}\n\nReported by: ${email.actorName}\nTime (UTC): ${email.createdAt}\n\nSign in to NexusFab to review this factory alert.`;
  return Buffer.from([
    `From: ${sender}`, `To: ${email.recipient}`, `Subject: ${subject}`,
    `Message-ID: <nexusfab-${email.id}@alerts.nexusfab.invalid>`, `Date: ${new Date(email.createdAt).toUTCString()}`,
    "MIME-Version: 1.0", 'Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: base64", "",
    Buffer.from(body).toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "",
  ].join("\r\n")).toString("base64url");
}
export async function sendAlertEmail(email: AlertEmail): Promise<string> {
  // Test/example addresses must never generate external messages, even in a running dev server.
  if (/\.(invalid|test|localhost)$|@(example\.(com|net|org))$/i.test(email.recipient)) throw new EmailFailure("RESERVED_EMAIL_DOMAIN");
  const connectors = new ReplitConnectors();
  let sender: string;
  try {
    const profile = await bounded(connectors.proxy("google-mail", "/gmail/v1/users/me/profile", { method: "GET" }));
    if (!profile.ok) throw new EmailFailure(`GMAIL_PROFILE_HTTP_${profile.status}`);
    const profileData = await profile.json() as { emailAddress?: unknown };
    if (typeof profileData.emailAddress !== "string" || /[\r\n]/.test(profileData.emailAddress)) throw new EmailFailure("GMAIL_PROFILE_INVALID");
    sender = profileData.emailAddress;
  } catch (error) {
    if (error instanceof EmailFailure) throw error;
    throw new EmailFailure("GMAIL_CONNECTION_UNAVAILABLE");
  }
  let response: Response;
  try {
    response = await bounded(connectors.proxy("google-mail", "/gmail/v1/users/me/messages/send", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: { raw: encodeAlertEmail(email, sender) },
    }));
  } catch { throw new EmailFailure("SEND_RESULT_UNKNOWN", true); }
  if (!response.ok) {
    // Only an explicit rate-limit rejection is automatically retried. 5xx may have sent.
    throw new EmailFailure(`GMAIL_SEND_HTTP_${response.status}`, response.status >= 500, response.status === 429);
  }
  try {
    const result = await response.json() as { id?: unknown };
    if (typeof result.id !== "string") throw new Error("MISSING_MESSAGE_ID");
    return result.id;
  } catch { throw new EmailFailure("SEND_RESULT_UNKNOWN", true); }
}
export async function findSentAlert(id: string): Promise<string | undefined> {
  const connectors = new ReplitConnectors();
  const response = await bounded(connectors.proxy("google-mail",
    `/gmail/v1/users/me/messages?q=${encodeURIComponent(`in:sent rfc822msgid:nexusfab-${id}@alerts.nexusfab.invalid`)}&maxResults=1`, { method: "GET" }));
  if (!response.ok) throw new EmailFailure("SENT_LOOKUP_UNAVAILABLE");
  const result = await response.json() as { messages?: { id?: unknown }[] };
  const idFound = result.messages?.[0]?.id;
  return typeof idFound === "string" ? idFound : undefined;
}
