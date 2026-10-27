"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const INTERVAL_MS = 30_000;
const CLIP_MS = 4_000;

type Label = "locked-in" | "brain-rot";
type Upload = { key: string; label: Label; status: "uploading" | "done" | "failed" };

function pickMime() {
  const options = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];
  return options.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

export default function Home() {
  const [name, setName] = useState("");
  const [consent, setConsent] = useState(false);
  const [label, setLabel] = useState<Label>("locked-in");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);

  const streamRef = useRef<MediaStream | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const labelRef = useRef<Label>(label);
  const nameRef = useRef(name);
  labelRef.current = label;
  nameRef.current = name;

  const patch = (key: string, status: Upload["status"]) =>
    setUploads((u) => u.map((x) => (x.key === key ? { ...x, status } : x)));

  const upload = useCallback(async (blob: Blob, clipLabel: Label) => {
    const ext = blob.type.includes("mp4") ? "mp4" : "webm";
    const contentType = blob.type.split(";")[0];
    let key = "";
    try {
      const res = await fetch("/api/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameRef.current, label: clipLabel, contentType, ext }),
      });
      if (!res.ok) throw new Error("presign failed");
      const { url, key: k } = await res.json();
      key = k;
      setUploads((u) => [{ key, label: clipLabel, status: "uploading" as const }, ...u].slice(0, 8));
      const put = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: blob });
      if (!put.ok) throw new Error(`upload ${put.status}`);
      patch(key, "done");
    } catch (e) {
      if (key) patch(key, "failed");
      setError(e instanceof Error ? e.message : "upload error");
    }
  }, []);

  const recordClip = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const clipLabel = labelRef.current;
    const mimeType = pickMime();
    const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_500_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => upload(new Blob(chunks, { type: rec.mimeType }), clipLabel);
    rec.start();
    setTimeout(() => rec.state !== "inactive" && rec.stop(), CLIP_MS);
  }, [upload]);

  const stop = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRunning(false);
  }, []);

  const start = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor", frameRate: 15 },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (track.getSettings().displaySurface !== "monitor") {
        stream.getTracks().forEach((t) => t.stop());
        setError('Pick "Entire Screen", not a window or tab.');
        return;
      }
      track.onended = stop;
      streamRef.current = stream;

      // worker timer: background tabs throttle main-thread timers
      const code = `setInterval(() => postMessage(0), ${INTERVAL_MS})`;
      const worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })));
      worker.onmessage = recordClip;
      workerRef.current = worker;

      setRunning(true);
      recordClip();
    } catch {
      setError("Screen share was cancelled.");
    }
  };

  useEffect(() => stop, [stop]);

  const canStart = name.trim().length > 0 && consent;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6 pb-32">
      <h1 className="text-2xl font-semibold">Brain rot detector</h1>
      <p className="text-sm text-neutral-500">
        Records 4 seconds of your screen every 30 seconds and uploads it. Keep this tab open.
      </p>

      <input
        className="rounded border border-neutral-300 bg-transparent p-2 disabled:opacity-50"
        placeholder="Your name"
        value={name}
        disabled={running}
        onChange={(e) => setName(e.target.value)}
      />

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={consent} disabled={running} onChange={(e) => setConsent(e.target.checked)} />
        <span>I understand my entire screen will be recorded and uploaded. I&apos;ll close anything private first.</span>
      </label>

      {running ? (
        <button onClick={stop} className="rounded bg-red-600 p-2 text-white">Stop recording</button>
      ) : (
        <button onClick={start} disabled={!canStart} className="rounded bg-black p-2 text-white disabled:opacity-40 dark:bg-white dark:text-black">
          Start
        </button>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="flex flex-col gap-1 text-xs text-neutral-500">
        {uploads.map((u) => (
          <li key={u.key} className="truncate">
            {u.status === "done" ? "✓" : u.status === "failed" ? "✗" : "…"} {u.key}
          </li>
        ))}
      </ul>

      <div className="fixed inset-x-0 bottom-0 flex justify-center p-4">
        <div className="flex gap-1 rounded-full border border-neutral-300 bg-white p-1 shadow-lg dark:bg-neutral-900">
          {(["locked-in", "brain-rot"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLabel(l)}
              className={`rounded-full px-4 py-2 text-sm ${label === l ? (l === "locked-in" ? "bg-green-600 text-white" : "bg-pink-600 text-white") : ""}`}
            >
              {l === "locked-in" ? "🔒 Locked in" : "🧠 Brain rot"}
            </button>
          ))}
        </div>
      </div>
    </main>
  );
}
