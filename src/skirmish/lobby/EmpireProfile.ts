export const MAX_EMPIRE_NAME_LENGTH = 20;

export interface EmpireProfile {
  readonly name: string;
  readonly flagCode: string | null;
}

export const DEFAULT_EMPIRE_PROFILE: EmpireProfile = Object.freeze({
  name: "Your Empire",
  flagCode: null,
});

export function createEmpireProfile(
  name: string,
  flagCode: string | null,
): EmpireProfile {
  const normalized = name.trim().normalize("NFC");
  if (!normalized || Array.from(normalized).length > MAX_EMPIRE_NAME_LENGTH)
    throw new Error(
      `Use an empire name of 1–${MAX_EMPIRE_NAME_LENGTH} characters.`,
    );
  // eslint-disable-next-line no-control-regex -- rejects control characters on purpose
  if (/[\u0000-\u001f\u007f]/u.test(normalized))
    throw new Error("Empire names cannot contain control characters.");
  return Object.freeze({ name: normalized, flagCode });
}
