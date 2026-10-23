"use client"

import { type Call, createPhone, type EndReason, type MicrophoneTest, type Phone, type PhoneState } from "@06line/sdk-browser"
import { Check, ChevronUp, Mic, MicOff, Phone as PhoneIcon, PhoneOff, User, Volume2, VolumeX } from "lucide-react"
import * as React from "react"

type LineView = { number: string; online: boolean; signal?: number }

// The devices and volumes chosen, and whether the microphone and the speaker are on, for the next calls and the one in
// progress.
type AudioChoice = {
  input: string
  output: string
  inputVolume: number
  outputVolume: number
  micOn: boolean
  speakerOn: boolean
}

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
  const [test, setTest] = React.useState<MicrophoneTest | null>(null)
  const [testError, setTestError] = React.useState<string | null>(null)
  const [audio, setAudio] = React.useState<AudioChoice>({
    input: "default",
    output: "default",
    inputVolume: 1,
    outputVolume: 1,
    micOn: true,
    speakerOn: true,
  })
  // The speaker can only be chosen where the browser allows it (not in Safari); switched off, it plays at volume 0.
  const audioOptions = {
    input: audio.input,
    output: phone?.canChooseOutput ? audio.output : undefined,
    inputVolume: audio.inputVolume,
    outputVolume: audio.speakerOn ? audio.outputVolume : 0,
  }

  // One phone per page: it opens the event stream and keeps it until the page closes; each call has its own WebRTC
  // session.
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

  const incoming = call?.direction === "inbound" && call.state === "ringing" ? call : null
  const inCall = call && !incoming && call.state !== "ended" ? call : null

  // The microphone test stops when it is replaced, when a call starts, and with the page.
  React.useEffect(() => () => test?.stop(), [test])

  async function toggleTest() {
    if (test) return setTest(null)

    setTestError(null)
    try {
      // The test has no mute: a microphone switched off plays at volume 0.
      setTest(await phone!.testMicrophone({ ...audioOptions, inputVolume: audio.micOn ? audio.inputVolume : 0 }))
    } catch (e) {
      setTestError((e as Error).message)
    }
  }

  // change keeps a choice for the next calls, and applies it at once to the call in progress, or else to the
  // microphone test.
  function change(next: Partial<AudioChoice>) {
    const choice = { ...audio, ...next }
    setAudio(choice)
    const live = inCall ?? test
    if (!live) return

    const fail = (e: Error) => setError(e.message)
    if (inCall && "micOn" in next) inCall.mute(!choice.micOn)
    if ("inputVolume" in next || (!inCall && "micOn" in next)) live.setInputVolume(inCall || choice.micOn ? choice.inputVolume : 0)
    if ("speakerOn" in next || "outputVolume" in next) live.setOutputVolume(choice.speakerOn ? choice.outputVolume : 0)
    if ("input" in next) void live.setInput(choice.input).catch(fail)
    if ("output" in next) void live.setOutput(choice.output).catch(fail)
  }

  // A call opens its microphone on; the one switched off before stays off.
  const dial = () =>
    act(async () => {
      setTest(null)
      const c = await phone!.call({ to: toE164(number), ...audioOptions })
      if (!audio.micOn) c.mute(true)
      follow(c)
    })
  const answer = (c: Call) =>
    act(async () => {
      setTest(null)
      await c.answer(audioOptions)
      if (!audio.micOn) c.mute(true)
    })

  const ready = state === "connected" && Boolean(line?.online)
  const controls = phone && <AudioControls phone={phone} audio={audio} change={change} />

  return (
    <div className="flex min-h-dvh flex-col bg-[#202124] text-[#e8eaed]">
      {call && !incoming ? (
        <CallRoom
          call={call}
          line={line}
          levels={levels}
          now={now}
          micOn={audio.micOn}
          controls={controls}
          onHangup={() => act(() => call.hangup())}
        />
      ) : (
        <Lobby
          phone={phone}
          line={line}
          state={state}
          ready={ready}
          number={number}
          setNumber={setNumber}
          testing={Boolean(test)}
          testError={testError}
          onTest={toggleTest}
          controls={controls}
          onCall={dial}
        />
      )}

      {incoming && (
        <IncomingDialog call={incoming} onAnswer={() => answer(incoming)} onDecline={() => act(() => incoming.hangup())} />
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

// Lobby is the screen before a call, like "Ready to join?" in Meet: your tile with the microphone and the speaker on
// the left, the number on the right.
function Lobby({
  phone,
  line,
  state,
  ready,
  number,
  setNumber,
  testing,
  testError,
  onTest,
  controls,
  onCall,
}: {
  phone: Phone | null
  line: LineView | null
  state: PhoneState
  ready: boolean
  number: string
  setNumber: (number: string) => void
  testing: boolean
  testError: string | null
  onTest: () => void
  controls: React.ReactNode
  onCall: () => void
}) {
  const status = state !== "connected" ? (state === "closed" ? "Disconnected" : "Connecting…") : line?.online ? "Online" : "Line offline"

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center gap-3 px-6 py-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#8ab4f8] text-xs font-bold text-[#202124]">06</div>
        <span className="text-lg text-[#e8eaed]">Softphone</span>
      </header>

      <div className="mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-6 pb-16 lg:grid-cols-[1.5fr_1fr]">
        <section className="relative aspect-[4/3] w-full rounded-2xl bg-[#3c4043] sm:aspect-video">
          <div className="absolute inset-0 flex items-center justify-center">
            <Avatar label="You" speaking={testing} />
          </div>
          {testing && <p className="absolute top-4 left-4 text-sm text-[#e8eaed]/80">You hear yourself 1.5 s later</p>}
          <div className="absolute inset-x-0 bottom-4 flex justify-center">{controls}</div>
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
            <button
              type="button"
              onClick={onTest}
              disabled={!phone}
              className={`flex items-center justify-center gap-2 rounded-full px-6 py-3 font-medium transition disabled:opacity-40 ${testing ? "bg-[#8ab4f8] text-[#202124] hover:bg-[#aecbfa]" : "text-[#8ab4f8] hover:bg-[#8ab4f8]/10"}`}
            >
              <Mic className="size-4" />
              {testing ? "Stop the test" : "Test your microphone"}
            </button>
            {testError ? (
              <p className="text-xs text-[#f28b82]">{testError}</p>
            ) : (
              <p className="text-xs text-[#9aa0a6]">+33 6 12 34 56 78 or 06 12 34 56 78</p>
            )}
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
  micOn,
  controls,
  onHangup,
}: {
  call: Call
  line: LineView | null
  levels: Levels
  now: number
  micOn: boolean
  controls: React.ReactNode
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
        <Tile name="You" muted={!micOn} speaking={!ended && micOn && levels.input > 0.06} />
      </div>

      <footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-6 pb-6">
        <p className="truncate text-sm">
          <span className="tabular-nums">{status}</span>
          <span className="mx-2 text-[#9aa0a6]">|</span>
          <span className="text-[#9aa0a6]">{line?.number}</span>
        </p>

        <div className="flex items-center gap-3">
          {controls}
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

// AudioControls are the microphone and the speaker of Meet: the round button switches it off and on, the arrow picks
// the device and the volume.
function AudioControls({ phone, audio, change }: { phone: Phone; audio: AudioChoice; change: (next: Partial<AudioChoice>) => void }) {
  const [devices, setDevices] = React.useState<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>({ inputs: [], outputs: [] })
  const [open, setOpen] = React.useState<"input" | "output" | null>(null)

  // The names of the devices appear once the browser allows the microphone, so the list is read on each opening.
  function toggleMenu(menu: "input" | "output") {
    if (open === menu) return setOpen(null)

    setOpen(menu)
    void phone.devices().then(setDevices)
  }

  return (
    <div className="flex items-center gap-3">
      <DeviceButton
        label={audio.micOn ? "Turn off microphone" : "Turn on microphone"}
        menuLabel="Microphone settings"
        on={audio.micOn}
        icon={audio.micOn ? <Mic className="size-5" /> : <MicOff className="size-5" />}
        onToggle={() => change({ micOn: !audio.micOn })}
        onMenu={() => toggleMenu("input")}
      >
        {open === "input" && (
          <DeviceMenu
            title="Microphone"
            devices={devices.inputs}
            value={audio.input}
            onSelect={(input) => change({ input })}
            volume={audio.inputVolume}
            onVolume={(inputVolume) => change({ inputVolume })}
            onClose={() => setOpen(null)}
          />
        )}
      </DeviceButton>
      <DeviceButton
        label={audio.speakerOn ? "Turn off sound" : "Turn on sound"}
        menuLabel="Speaker settings"
        on={audio.speakerOn}
        icon={audio.speakerOn ? <Volume2 className="size-5" /> : <VolumeX className="size-5" />}
        onToggle={() => change({ speakerOn: !audio.speakerOn })}
        onMenu={() => toggleMenu("output")}
      >
        {open === "output" && (
          <DeviceMenu
            title="Speakers"
            devices={phone.canChooseOutput ? devices.outputs : null}
            value={audio.output}
            onSelect={(output) => change({ output })}
            volume={audio.outputVolume}
            onVolume={(outputVolume) => change({ outputVolume })}
            onClose={() => setOpen(null)}
          />
        )}
      </DeviceButton>
    </div>
  )
}

function DeviceButton({
  label,
  menuLabel,
  on,
  icon,
  onToggle,
  onMenu,
  children,
}: {
  label: string
  menuLabel: string
  on: boolean
  icon: React.ReactNode
  onToggle: () => void
  onMenu: () => void
  children: React.ReactNode
}) {
  return (
    <div className="relative flex items-center rounded-full bg-[#202124]/70">
      <button onClick={onMenu} aria-label={menuLabel} title={menuLabel} className="flex h-12 w-8 items-center justify-center rounded-l-full pl-1 hover:bg-white/10">
        <ChevronUp className="size-4" />
      </button>
      <button
        onClick={onToggle}
        aria-label={label}
        title={label}
        className={`flex size-12 items-center justify-center rounded-full transition ${on ? "bg-[#3c4043] hover:bg-[#4a4e51]" : "bg-[#ea4335] text-white hover:bg-[#d93025]"}`}
      >
        {icon}
      </button>
      {children}
    </div>
  )
}

// DeviceMenu opens above its button: the devices to pick from (null where the browser cannot choose) and the volume.
function DeviceMenu({
  title,
  devices,
  value,
  onSelect,
  volume,
  onVolume,
  onClose,
}: {
  title: string
  devices: MediaDeviceInfo[] | null
  value: string
  onSelect: (id: string) => void
  volume: number
  onVolume: (volume: number) => void
  onClose: () => void
}) {
  const choices = [
    { id: "default", name: "Same as system" },
    ...(devices ?? []).filter((d) => d.deviceId && d.deviceId !== "default").map((d) => ({ id: d.deviceId, name: d.label || "Unnamed device" })),
  ]

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute bottom-full left-0 z-40 mb-3 w-72 rounded-xl bg-[#2d2e31] py-2 text-left text-sm shadow-2xl">
        <p className="px-4 py-2 text-xs font-medium text-[#9aa0a6]">{title}</p>
        {devices ? (
          choices.map((choice) => (
            <button
              key={choice.id}
              onClick={() => {
                onSelect(choice.id)
                onClose()
              }}
              className="flex w-full items-center gap-3 px-4 py-2.5 hover:bg-white/5"
            >
              <Check className={`size-4 shrink-0 ${choice.id === value ? "text-[#8ab4f8]" : "invisible"}`} />
              <span className="truncate">{choice.name}</span>
            </button>
          ))
        ) : (
          <p className="px-4 py-2 text-[#9aa0a6]">This browser plays through the system speaker.</p>
        )}
        {devices?.every((d) => !d.label) && <p className="px-4 pb-2 text-xs text-[#9aa0a6]">Names appear once the browser allows the microphone.</p>}
        <label className="mt-1 block border-t border-white/10 px-4 pt-3 pb-2">
          <span className="flex justify-between text-xs text-[#9aa0a6]">
            <span>Volume</span>
            <span className="tabular-nums">{Math.round(volume * 100)} %</span>
          </span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={volume}
            onChange={(event) => onVolume(Number(event.target.value))}
            className="mt-2 w-full accent-[#8ab4f8]"
          />
        </label>
      </div>
    </>
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
