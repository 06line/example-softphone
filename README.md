# 06 Line softphone example

A softphone in the browser with [`@06line/sdk-browser`](https://www.npmjs.com/package/@06line/sdk-browser): call,
receive calls, mute, pick the microphone and the speaker, set their volumes, and test the microphone. Next.js and
Tailwind, laid out like a video call, run with bun.

## Run it

```sh
cp .env.example .env.local   # then put an API key of your company in it
mise install                 # or install bun 1.4 yourself
mise run dev                 # http://localhost:3000
```

Open it in Chrome, Edge, Firefox or Safari. The page asks for the microphone on the first call.

## How it fits together

| File | Runs on | What it does |
| --- | --- | --- |
| `app/api/06line-key/route.ts` | your server | Creates a 15-minute ephemeral key with your API key, which never reaches the browser |
| `app/page.tsx` | your server | Renders the page with your lines (`GET /v1/lines`), so the number shows before the phone connects |
| `components/softphone.tsx` | the browser | `createPhone()`, the waiting room, the call room, the incoming call and the audio settings |

The SDK does the rest: the event stream and its reconnections, the WebRTC session of each call, key renewal, devices,
volumes, mute and levels.
In your app, check that the user is signed in before `/api/06line-key` hands out a key.

## License

MIT
