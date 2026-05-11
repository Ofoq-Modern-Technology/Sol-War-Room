import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// License checking is opt-in. Set LICENSE_CHECK_ENABLED=1 to enable.
// By default (not set), all requests are allowed without a license key.
const LICENSE_CHECK_ENABLED = process.env.LICENSE_CHECK_ENABLED === "1";

const LICENSE_SERVER_URL =
  process.env.LICENSE_SERVER_URL ?? "https://license.ofoq.om";

function licenseApi(path: string) {
  return `${LICENSE_SERVER_URL}/license${path}`;
}

export interface LicenseStatus {
  status: "unchecked" | "valid" | "invalid" | "expired" | "unlicensed";
  licenseKey?: string;
  expiresAt?: Date | null;
  checkedAt?: Date | null;
}

export async function checkLicenseOnStartup(): Promise<void> {
  if (!LICENSE_CHECK_ENABLED) return;

  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (!row?.licenseKey) return;

  try {
    const res = await fetch(licenseApi("/validate"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        key: row.licenseKey,
        instanceId: row.licenseInstanceId ?? undefined,
      }),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json() as {
      valid?: boolean;
      error?: string;
      status?: string;
      expiresAt?: string | null;
    };

    const status = data.valid
      ? "valid"
      : data.status === "expired" ? "expired" : "invalid";

    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;

    await db.update(settingsTable).set({
      licenseStatus: status,
      licenseExpiresAt: expiresAt,
      licenseCheckedAt: new Date(),
    }).where(eq(settingsTable.id, 1));

    console.log(`[license] status: ${status}`);
  } catch (e) {
    console.warn("[license] validation check failed (offline?):", e);
  }
}

export async function getLicenseStatus(): Promise<LicenseStatus> {
  if (!LICENSE_CHECK_ENABLED) {
    return { status: "valid" };
  }

  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (!row?.licenseKey) return { status: "unlicensed" };

  return {
    status: (row.licenseStatus as LicenseStatus["status"]) ?? "unchecked",
    licenseKey: `${row.licenseKey.slice(0, 8)}${"•".repeat(Math.max(0, row.licenseKey.length - 12))}${row.licenseKey.slice(-4)}`,
    expiresAt: row.licenseExpiresAt,
    checkedAt: row.licenseCheckedAt,
  };
}

export async function activateLicense(licenseKey: string): Promise<{ success: boolean; error?: string }> {
  if (!LICENSE_CHECK_ENABLED) {
    return { success: false, error: "License checking is not enabled on this installation." };
  }

  const instanceName = `solwarroom-${Date.now()}`;

  const res = await fetch(licenseApi("/activate"), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ key: licenseKey, instanceName }),
    signal: AbortSignal.timeout(10000),
  });

  const data = await res.json() as {
    activated?: boolean;
    error?: string;
    instance?: { id: string; name: string };
    license_key?: { status?: string; expires_at?: string | null };
  };

  if (!data.activated || !data.instance?.id) {
    return { success: false, error: data.error ?? "Activation failed — check your license key." };
  }

  const instanceId = data.instance.id;
  const expiresAt = data.license_key?.expires_at ? new Date(data.license_key.expires_at) : null;

  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (row?.licenseKey && row.licenseInstanceId && row.licenseKey !== licenseKey) {
    await fetch(licenseApi("/deactivate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: row.licenseKey, instanceId: row.licenseInstanceId }),
    }).catch(() => {});
  }

  if (row) {
    await db.update(settingsTable).set({
      licenseKey,
      licenseInstanceId: instanceId,
      licenseStatus: "valid",
      licenseExpiresAt: expiresAt,
      licenseCheckedAt: new Date(),
    }).where(eq(settingsTable.id, 1));
  } else {
    await db.insert(settingsTable).values({
      licenseKey,
      licenseInstanceId: instanceId,
      licenseStatus: "valid",
      licenseExpiresAt: expiresAt,
      licenseCheckedAt: new Date(),
    });
  }

  return { success: true };
}

export async function deactivateLicense(): Promise<void> {
  if (!LICENSE_CHECK_ENABLED) return;

  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (!row?.licenseKey) return;

  await fetch(licenseApi("/deactivate"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: row.licenseKey, instanceId: row.licenseInstanceId ?? undefined }),
  }).catch(() => {});

  await db.update(settingsTable).set({
    licenseKey: null,
    licenseInstanceId: null,
    licenseStatus: "unchecked",
    licenseExpiresAt: null,
  }).where(eq(settingsTable.id, 1));
}
