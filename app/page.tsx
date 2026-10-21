import { Softphone } from "@/components/softphone"
import { sixline, type ServerLine } from "@/lib/server"

// Rendered on the server: the lines come with the page, so the phone shows its number before the WebRTC session opens.
export const dynamic = "force-dynamic"

export default async function Page() {
  const { lines } = await sixline<{ lines: ServerLine[] }>("/v1/lines")

  return (
    <Softphone
      apiUrl={process.env.NEXT_PUBLIC_SIXLINE_API_URL ?? "https://api.06line.com"}
      initialLine={lines[0] ? { number: lines[0].phone_number, online: lines[0].online } : null}
    />
  )
}
