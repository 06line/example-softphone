"use client"

import { type Call, createPhone, type EndReason, type Phone, type PhoneState } from "@06line/sdk-browser"
import { HeadphoneOff, Headphones, Mic, MicOff, Phone as PhoneIcon, PhoneOff, Settings, User, X } from "lucide-react"
import * as React from "react"

type LineView = { number: string; online: boolean; signal?: number }

// The devices and volumes chosen in the settings, for the next calls and the one in progress.
type AudioChoice = { input: string; output: string; inputVolume: number; outputVolume: number }

type Levels = { input: number; output: number }

const endReasons: Record<EndReason, string> = {
  hangup: "You left the call",
  remote_hangup: "They hung up",
  no_answer: "No answer",
  busy: "Busy",
  line_offline: "Your line went offline",
  failed: "The call failed",
  answered_elsewhere: "Answered on another device",
}

// toE164 accepts what people type: +33612345678, or a French number such as 06 12 34 56 78.
function toE164(input: string): string {
  const digits = input.replace(/[^\d+]/g, "")
  if (/^0\d{9}$/.test(digits)) return "+33" + digits.slice(1)

  return digits
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

export function Softphone({ apiUrl, initialLine }: { apiUrl: string; initialLine: LineView | null }) {
  const [phone, setPhone] = React.useState<Phone | null>(null)
  const [state, setState] = React.useState<PhoneState>("connecting")
  const [line, setLine] = React.useState<LineView | null>(initialLine)
  const [number, setNumber] = React.useState("")
  const [call, setCall] = React.useState<Call | null>(null)
  const [, redraw] = React.useReducer((n: number) => n + 1, 0)
  const [levels, setLevels] = React.useState<Levels>({ input: 0, output: 0 })
  const [now, setNow] = React.useState(0)
  const [error, setError] = React.useState<string | null>(null)
  const [settings, setSettings] = React.useState(false)
  // Deafened, the call is silent and the microphone off, like in Discord; mutedBefore is the microphone to restore.
  const [deafened, setDeafened] = React.useState<{ mutedBefore: boolean } | null>(null)
  const [audio, setAudio] = React.useState<AudioChoice>({ input: "default", output: "default", inputVolume: 1, outputVolume: 1 })
  // The speaker can only be chosen where the browser allows it (not in Safari).
  const audioOptions = { ...audio, output: phone?.canChooseOutput ? audio.output : undefined }

  // One phone per page: it opens the WebRTC session and keeps it until the page closes.
  React.useEffect(() => {
    const p = createPhone({
      baseUrl: apiUrl,
      getEphemeralKey: () => fetch("/api/06line-key", { method: "POST" }).then((r) => r.json()),
    })

    const off = [
      p.on("state", (s) => {
        setState(s)
        const first = p.lines[0]
        if (first) setLine({ number: first.phoneNumber, online: first.online, signal: first.signal })
      }),
      p.on("line", (l) => setLine({ number: l.phoneNumber, online: l.online, signal: l.signal })),
      p.on("incoming", (c) => follow(c)),
      p.on("error", (e) => setError(e.message)),
    ]
    setPhone(p)

    return () => {
      off.forEach((f) => f())
      void p.disconnect()
    }
  }, [apiUrl])

  // follow shows a call and redraws on each of its changes; the end screen stays a few seconds. An incoming call that
  // ends before it was answered here (missed, or answered on another device) just stops ringing.
  function follow(c: Call) {
    setCall(c)
    setDeafened(null)
    setLevels({ input: 0, output: 0 })
    c.on("state", redraw)
    c.on("level", setLevels)
    c.on("ended", () => {
      const missed = c.direction === "inbound" && !c.answeredAt
      setTimeout(() => setCall((current) => (current === c ? null : current)), missed ? 0 : 3000)
    })
  }

  // The talk time ticks once a second during a call.
  React.useEffect(() => {
    if (!call) return

    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)

    return () => clearInterval(timer)
  }, [call])

  // Errors fade like a snackbar.
  React.useEffect(() => {
    if (!error) return

    const timer = setTimeout(() => setError(null), 6000)

    return () => clearTimeout(timer)
  }, [error])

  async function act(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function deafen(c: Call) {
    if (deafened) {
      c.setOutputVolume(audio.outputVolume)
      c.mute(deafened.mutedBefore)
      return setDeafened(null)
    }

    setDeafened({ mutedBefore: c.muted })
    c.setOutputVolume(0)
    c.mute(true)
  }

  const dial = () => act(async () => follow(await phone!.call({ to: toE164(number), ...audioOptions })))
  const ready = state === "connected" && Boolean(line?.online)
  const incoming = call?.direction === "inbound" && call.state === "ringing" ? call : null
  const inCall = call && !incoming ? call : null

  return (
    <div className="flex min-h-dvh flex-col bg-[#202124] text-[#e8eaed]">
      {inCall ? (
        <CallRoom
          call={inCall}
          line={line}
          levels={levels}
          now={now}
          deafened={Boolean(deafened)}
          onDeafen={() => deafen(inCall)}
          onSettings={() => setSettings(true)}
          onHangup={() => act(() => inCall.hangup())}
        />
      ) : (
        <Lobby
          phone={phone}
          line={line}
          state={state}
          ready={ready}
          number={number}
          setNumber={setNumber}
          audio={audio}
          onCall={dial}
          onSettings={() => setSettings(true)}
        />
      )}

      {incoming && (
        <IncomingDialog
          call={incoming}
          onAnswer={() => act(() => incoming.answer(audioOptions))}
          onDecline={() => act(() => incoming.hangup())}
        />
      )}

      {settings && phone && (
        <SettingsPanel phone={phone} call={inCall} deafened={Boolean(deafened)} audio={audio} setAudio={setAudio} onClose={() => setSettings(false)} />
      )}

      {error && (
        <div
          role="alert"
          className="fixed bottom-6 left-6 z-50 flex max-w-sm items-center gap-4 rounded-lg bg-[#323232] px-4 py-3 text-sm shadow-xl"
        >
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="font-medium text-[#8ab4f8]">
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

// Lobby is the screen before a call, like "Ready to join?" in Meet: your tile on the left, the number on the right.
function Lobby({
  phone,
  line,
  state,
  ready,
  number,
  setNumber,
  audio,
  onCall,
  onSettings,
}: {
  phone: Phone | null
  line: LineView | null
  state: PhoneState
  ready: boolean
  number: string
  setNumber: (number: string) => void
  audio: AudioChoice
  onCall: () => void
  onSettings: () => void
}) {
  const [test, setTest] = React.useState<{ stop(): void } | null>(null)
  const [testError, setTestError] = React.useState<string | null>(null)

  React.useEffect(() => () => test?.stop(), [test])

  async function toggleTest() {
    if (test) return setTest(null)

    setTestError(null)
    try {
      setTest(await phone!.testMicrophone({ ...audio, output: phone!.canChooseOutput ? audio.output : undefined }))
    } catch (e) {
      setTestError((e as Error).message)
    }
  }

  const status = state !== "connected" ? (state === "closed" ? "Disconnected" : "Connecting…") : line?.online ? "Online" : "Line offline"

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center gap-3 px-6 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#8ab4f8] text-xs font-bold text-[#202124]">06</div>
        <span className="text-lg text-[#e8eaed]">Softphone</span>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-6 pb-16 lg:grid-cols-[1.5fr_1fr]">
        <section className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl bg-[#3c4043] sm:aspect-video">
          <div className="absolute inset-0 flex items-center justify-center">
            <Avatar label="You" speaking={Boolean(test)} />
          </div>
          <p className="absolute top-4 left-4 text-sm text-[#e8eaed]/80">
            {test ? "You hear yourself half a second later" : "The browser asks for your microphone on the first test or call"}
          </p>
          <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
            <button
              onClick={toggleTest}
              disabled={!phone}
              className={`flex h-12 items-center gap-2 rounded-full px-5 text-sm font-medium transition disabled:opacity-40 ${test ? "bg-[#8ab4f8] text-[#202124] hover:bg-[#aecbfa]" : "bg-[#202124]/70 hover:bg-[#202124]"}`}
            >
              <Mic className="size-5" />
              {test ? "Stop the test" : "Test your microphone"}
            </button>
            <ControlButton label="Audio settings" onClick={onSettings} disabled={!phone}>
              <Settings className="size-5" />
            </ControlButton>
          </div>
          {testError && <p className="absolute top-12 left-4 text-xs text-[#f28b82]">{testError}</p>}
        </section>

        <section className="flex flex-col items-center text-center">
          <h1 className="text-3xl font-normal">Ready to call?</h1>
          <p className="mt-3 flex items-center gap-2 text-sm text-[#9aa0a6]">
            <span className={`size-2 rounded-full ${ready ? "bg-[#81c995]" : "bg-[#9aa0a6]"}`} />
            {line ? `From ${line.number}` : "No line"} · {status}
          </p>

          <form
            className="mt-8 flex w-full max-w-xs flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              onCall()
            }}
          >
            <input
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              placeholder="Phone number"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              className="rounded-lg border border-[#5f6368] bg-transparent px-4 py-3 text-center text-lg tracking-wide placeholder:text-[#9aa0a6] focus:border-[#8ab4f8] focus:outline-none"
            />
            <button
              type="submit"
              disabled={!ready || toE164(number).length < 8}
              className="rounded-full bg-[#8ab4f8] px-6 py-3 font-medium text-[#202124] transition hover:bg-[#aecbfa] hover:shadow-lg disabled:bg-[#3c4043] disabled:text-[#9aa0a6]"
            >
              Call now
            </button>
            <p className="text-xs text-[#9aa0a6]">+33 6 12 34 56 78 or 06 12 34 56 78</p>
          </form>
        </section>
      </div>
    </main>
  )
}

// CallRoom is the call itself: one tile per voice, outlined while it speaks, and the control bar of Meet.
function CallRoom({
  call,
  line,
  levels,
  now,
  deafened,
  onDeafen,
  onSettings,
  onHangup,
}: {
  call: Call
  line: LineView | null
  levels: Levels
  now: number
  deafened: boolean
  onDeafen: () => void
  onSettings: () => void
  onHangup: () => void
}) {
  const peer = call.direction === "inbound" ? call.from : call.to
  const ended = call.state === "ended"
  const status = ended
    ? endReasons[call.endReason ?? "hangup"]
    : call.state === "active" && call.answeredAt
      ? clock(Math.max(0, Math.floor((now - call.answeredAt.getTime()) / 1000)))
      : call.state === "ringing"
        ? "Ringing…"
        : "Calling…"

  return (
    <main className="flex flex-1 flex-col">
      <div className="grid flex-1 content-center gap-4 p-4 md:grid-cols-2">
        <Tile name={peer} note={call.state === "active" ? undefined : status} speaking={!ended && levels.output > 0.06} />
        <Tile name="You" muted={call.muted} speaking={!ended && !call.muted && levels.input > 0.06} />
      </div>

      <footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 pb-6">
        <p className="truncate text-sm">
          <span className="tabular-nums">{status}</span>
          <span className="mx-2 text-[#9aa0a6]">|</span>
          <span className="text-[#9aa0a6]">{line?.number}</span>
        </p>

        <div className="flex items-center gap-3">
          <ControlButton
            label={call.muted ? "Turn on microphone" : "Turn off microphone"}
            danger={call.muted}
            disabled={ended || deafened}
            onClick={() => call.mute(!call.muted)}
          >
            {call.muted ? <MicOff className="size-5" /> : <Mic className="size-5" />}
          </ControlButton>
          <ControlButton label={deafened ? "Undeafen" : "Deafen"} danger={deafened} disabled={ended} onClick={onDeafen}>
            {deafened ? <HeadphoneOff className="size-5" /> : <Headphones className="size-5" />}
          </ControlButton>
          <ControlButton label="Audio settings" onClick={onSettings} disabled={ended}>
            <Settings className="size-5" />
          </ControlButton>
          <button
            onClick={onHangup}
            disabled={ended}
            aria-label="Hang up"
            title="Hang up"
            className="flex h-12 w-16 items-center justify-center rounded-full bg-[#ea4335] text-white transition hover:bg-[#d93025] disabled:opacity-40"
          >
            <PhoneOff className="size-5" />
          </button>
        </div>

        <span />
      </footer>
    </main>
  )
}

function Tile({ name, note, muted, speaking }: { name: string; note?: string; muted?: boolean; speaking?: boolean }) {
  return (
    <div
      className={`relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-[#3c4043] ring-4 transition-shadow duration-150 ${speaking ? "ring-[#8ab4f8]" : "ring-transparent"}`}
    >
      <Avatar label={name} speaking={speaking} />
      {note && <p className="absolute top-4 right-0 left-0 text-center text-sm text-[#e8eaed]/80">{note}</p>}
      <span className="absolute bottom-3 left-4 text-sm font-medium tabular-nums">{name}</span>
      {muted && (
        <span className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-[#202124]/70">
          <MicOff className="size-4" />
        </span>
      )}
    </div>
  )
}

function Avatar({ label, speaking }: { label: string; speaking?: boolean }) {
  const initials = label === "You" ? null : label.slice(-2)

  return (
    <div
      className={`flex size-20 items-center justify-center rounded-full bg-[#5f6368] text-3xl sm:size-28 sm:text-4xl font-light transition-transform duration-150 ${speaking ? "scale-105" : ""}`}
    >
      {initials ?? <User className="size-12" />}
    </div>
  )
}

function ControlButton({
  label,
  active,
  danger,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; danger?: boolean }) {
  const colors = danger
    ? "bg-[#ea4335] text-white hover:bg-[#d93025]"
    : active
      ? "bg-[#8ab4f8] text-[#202124] hover:bg-[#aecbfa]"
      : "bg-[#3c4043] hover:bg-[#4a4e51]"

  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`flex size-12 items-center justify-center rounded-full transition disabled:opacity-40 ${colors}`}
    >
      {children}
    </button>
  )
}

// IncomingDialog rings in the middle of the screen until the call is answered or declined.
function IncomingDialog({ call, onAnswer, onDecline }: { call: Call; onAnswer: () => void; onDecline: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-[#2d2e31] p-8 text-center shadow-2xl">
        <div className="animate-ring mx-auto flex size-20 items-center justify-center rounded-full bg-[#5f6368] text-3xl font-light">
          {call.from.slice(-2)}
        </div>
        <p className="mt-5 text-sm text-[#9aa0a6]">Incoming call</p>
        <p className="mt-1 text-2xl tabular-nums">{call.from}</p>
        <p className="mt-1 text-sm text-[#9aa0a6]">to {call.to}</p>

        <div className="mt-8 flex gap-3">
          <button onClick={onDecline} className="flex-1 rounded-full bg-[#3c4043] py-3 font-medium text-[#f28b82] transition hover:bg-[#4a4e51]">
            Decline
          </button>
          <button
            onClick={onAnswer}
            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#8ab4f8] py-3 font-medium text-[#202124] transition hover:bg-[#aecbfa]"
          >
            <PhoneIcon className="size-4" />
            Answer
          </button>
        </div>
      </div>
    </div>
  )
}

// SettingsPanel picks the microphone and the speaker and sets both volumes. During a call the changes apply at once;
// otherwise they are used for the next call.
function SettingsPanel({
  phone,
  call,
  deafened,
  audio,
  setAudio,
  onClose,
}: {
  phone: Phone
  call: Call | null
  deafened: boolean
  audio: AudioChoice
  setAudio: React.Dispatch<React.SetStateAction<AudioChoice>>
  onClose: () => void
}) {
  const [devices, setDevices] = React.useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] })
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    void phone.devices().then(setDevices)
  }, [phone])

  // change keeps a setting for the next calls, and applies it to the call in progress.
  function change<K extends keyof AudioChoice>(key: K, value: AudioChoice[K], live: (call: Call) => Promise<void> | void) {
    setAudio((a) => ({ ...a, [key]: value }))
    if (!call) return

    setError(null)
    Promise.resolve(live(call)).catch((e: Error) => setError(e.message))
  }

  return (
    <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-sm flex-col bg-[#202124] p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-xl">Audio</h2>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-[#3c4043]" aria-label="Close">
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-8 space-y-7 text-sm">
          <Field label="Microphone">
            <Select value={audio.input} devices={devices.inputs} onChange={(id) => change("input", id, (c) => c.setInput(id))} />
          </Field>
          <Slider label="Microphone volume" value={audio.inputVolume} onChange={(v) => change("inputVolume", v, (c) => c.setInputVolume(v))} />

          {phone.canChooseOutput && (
            <Field label="Speakers">
              <Select value={audio.output} devices={devices.outputs} onChange={(id) => change("output", id, (c) => c.setOutput(id))} />
            </Field>
          )}
          {/* Deafened, the new volume waits for the call to be heard again. */}
          <Slider
            label="Speaker volume"
            value={audio.outputVolume}
            onChange={(v) => change("outputVolume", v, (c) => (deafened ? undefined : c.setOutputVolume(v)))}
          />

          {devices.inputs.every((d) => !d.label) && (
            <p className="text-xs text-[#9aa0a6]">Device names appear once the browser allows the microphone (test it, or call).</p>
          )}
          {error && <p className="text-xs text-[#f28b82]">{error}</p>}
        </div>
      </aside>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-[#8ab4f8]">{label}</span>
      {children}
    </label>
  )
}

function Select({ value, devices, onChange }: { value: string; devices: MediaDeviceInfo[]; onChange: (id: string) => void }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-lg border border-[#5f6368] bg-[#202124] px-3 py-2.5 focus:border-[#8ab4f8] focus:outline-none"
    >
      <option value="default">Same as system</option>
      {devices
        .filter((d) => d.deviceId && d.deviceId !== "default")
        .map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || "Unnamed device"}
          </option>
        ))}
    </select>
  )
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block space-y-2">
      <span className="flex justify-between">
        <span className="text-[#8ab4f8]">{label}</span>
        <span className="tabular-nums text-[#9aa0a6]">{Math.round(value * 100)} %</span>
      </span>
      <input
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[#8ab4f8]"
      />
    </label>
  )
}
