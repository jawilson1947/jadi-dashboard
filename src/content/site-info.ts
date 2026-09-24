/**
 * Facts the public pages state about this deployment, in ONE place.
 *
 * Everything here is institution-specific and was NOT inferred from the codebase — the values below
 * are placeholders marked TODO. Edit this file (not the page copy) before the pages go in front of
 * anyone, and have the privacy page reviewed by whoever owns data protection at the institution:
 * a privacy policy is a legal statement, and this one describes real student financial records.
 */
export const SITE_INFO = {
  /** The application's own name, as users see it. */
  appName: "JADI Dashboard",
  /** The institution whose data this deployment analyses. TODO: confirm the legal name. */
  institution: "the University",
  /** Who built and maintains it. */
  vendor: "Digital Support Systems",
  /** Where the office that answers questions about the data sits. TODO: confirm. */
  dataOwner: "the Student Accounts office",

  support: {
    /** TODO: real support mailbox. */
    email: "support@digitalsupportsystems.com",
    /** TODO: real number, or delete the line and the page drops it. */
    phone: "",
    /** TODO: confirm. */
    hours: "Monday to Friday, 8:00 am – 5:00 pm Central",
  },

  /** Who to contact about the handling of personal data. TODO: confirm the office and address. */
  privacyContact: {
    office: "the Registrar / Student Accounts office",
    email: "",
  },

  /** Shown on the privacy page so a reader knows how current it is. */
  policyLastReviewed: "2026-09-24",
} as const;

/** True when a contact detail has been filled in — the pages omit blank ones rather than print "TBD". */
export function has(value: string): boolean {
  return value.trim().length > 0;
}
