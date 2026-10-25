"use client";
import { useEffect, useRef } from "react";
import type { CameraDef } from "@/lib/surveillance";

interface Props { cam: CameraDef; person: boolean; doorOpen: boolean }

/** Shows the real stream when a URL is configured; otherwise an animated stand-in. */
export function CameraFeed({ cam, person, doorOpen }: Props) {
  if (cam.streamUrl) {
    const video = /\.(mp4|webm|ogg)(\?|$)/i.test(cam.streamUrl);
    return video
      ? <video src={cam.streamUrl} autoPlay muted playsInline loop className="aspect-video w-full bg-black object-cover" aria-label={cam.name} />
      // eslint-disable-next-line @next/next/no-img-element
      : <img src={cam.streamUrl} alt={`${cam.name} live feed`} className="aspect-video w-full bg-black object-cover" />;
  }
  return <SimFeed cam={cam} person={person} doorOpen={doorOpen} />;
}

function SimFeed({ cam, person, doorOpen }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef({ person, doorOpen });
  useEffect(() => { live.current = { person, doorOpen }; }, [person, doorOpen]);

  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    const W = c.width, H = c.height;
    let raf = 0, px = -30, t0 = performance.now();

    const draw = (now: number) => {
      const dt = (now - t0) / 1000; t0 = now;
      const { person, doorOpen } = live.current;
      ctx.fillStyle = "#0b100d"; ctx.fillRect(0, 0, W, H);

      if (cam.view === "interior") {
        // three crop rows seen from above
        for (let r = 0; r < 3; r++) {
          const y = 55 + r * 55;
          ctx.fillStyle = "#16301f"; ctx.fillRect(20, y, W - 40, 26);
          ctx.fillStyle = "#1f5a33";
          for (let x = 30; x < W - 30; x += 24) ctx.fillRect(x, y + 5, 14, 16);
        }
      } else {
        // entrance wall with a door
        ctx.fillStyle = "#18211b"; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = "#101712"; ctx.fillRect(W / 2 - 60, 20, 120, H - 20);
        if (doorOpen) {
          ctx.fillStyle = "#0a0f0c"; ctx.fillRect(W / 2 - 60, 20, 120, H - 20);
          ctx.fillStyle = "#3a4a3f";
          ctx.beginPath(); ctx.moveTo(W / 2 - 60, 20); ctx.lineTo(W / 2 - 10, 34); ctx.lineTo(W / 2 - 10, H - 14); ctx.lineTo(W / 2 - 60, H - 20); ctx.fill();
          ctx.fillStyle = "#e5b04a"; ctx.font = "bold 12px sans-serif"; ctx.fillText("DOOR OPEN", W / 2 + 6, 50);
        } else {
          ctx.fillStyle = "#2a382e"; ctx.fillRect(W / 2 - 56, 24, 112, H - 28);
          ctx.fillStyle = "#6b7d70"; ctx.fillRect(W / 2 + 40, H / 2, 6, 14);
        }
      }

      if (person) {
        px += dt * 60; if (px > W + 30) px = -30;
        const y = cam.view === "interior" ? 120 : H - 60;
        ctx.fillStyle = "#c9d6cd";
        ctx.beginPath(); ctx.arc(px, y, 10, 0, 7); ctx.fill();
        ctx.fillRect(px - 8, y + 8, 16, 30);
        ctx.strokeStyle = "#3ecf7a"; ctx.lineWidth = 2; ctx.strokeRect(px - 18, y - 16, 36, 62);
        ctx.fillStyle = "#3ecf7a"; ctx.font = "11px monospace"; ctx.fillText("person 0.93", px - 18, y - 21);
      } else px = -30;

      ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.font = "11px monospace";
      ctx.fillText(`${cam.id}  ${new Date().toLocaleTimeString([], { hour12: false })}`, 10, H - 10);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cam]);

  return <canvas ref={ref} width={480} height={270} role="img" aria-label={`${cam.name} (simulated feed)`} className="aspect-video w-full bg-black" />;
}
