export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`school-kiosk-pin:v1:${pin}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function pinsMatch(pin: string, pinHash: string): Promise<boolean> {
  const hashed = await hashPin(pin.trim());
  return hashed === pinHash;
}
