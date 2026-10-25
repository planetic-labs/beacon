export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export interface MailDelivery {
  send(mail: Mail): Promise<void>;
}
class ResendDelivery implements MailDelivery {
  async send(mail: Mail) {
    if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)
      throw new Error("Email delivery is not configured");
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: process.env.EMAIL_FROM, ...mail }),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) throw new Error("Email delivery failed");
  }
}
// Tests inject a delivery adapter; production never exposes OTPs through logs or APIs.
const providers: Record<string, () => MailDelivery> = {
  resend: () => new ResendDelivery(),
};
export function createMailDelivery(
  name = process.env.MAIL_PROVIDER ?? "resend",
): MailDelivery {
  const create = providers[name];
  if (!create) throw new Error("Unsupported mail delivery provider");
  return create();
}
export const mailDelivery: MailDelivery = createMailDelivery();
