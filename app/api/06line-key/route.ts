import { sixline } from "@/lib/server"

// The browser asks here for an ephemeral key: 15 minutes, calls only, never your API key. In your app, check first
// that the user is signed in and may use the phone.
export async function POST() {
  return Response.json(await sixline("/v1/ephemeral-keys", { method: "POST", body: {} }))
}
