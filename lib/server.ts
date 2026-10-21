import "server-only"

// The 06 Line API as your server calls it, with the API key that never reaches the browser.
const apiUrl = process.env.SIXLINE_API_URL ?? "https://api.06line.com"

export async function sixline<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const key = process.env.SIXLINE_API_KEY
  if (!key) throw new Error("SIXLINE_API_KEY is not set: copy .env.example to .env.local")

  const response = await fetch(apiUrl + path, {
    method: init?.method ?? "GET",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  })

  if (!response.ok) throw new Error(`06 Line answered ${response.status} to ${path}: ${await response.text()}`)

  return response.json() as Promise<T>
}

export type ServerLine = { id: string; phone_number: string; online: boolean; signal?: number; network?: string }
