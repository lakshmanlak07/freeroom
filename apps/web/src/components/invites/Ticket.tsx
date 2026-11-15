/**
 * The study-session ticket: brand header, big tabular time, a perforated tear line, and a QR of the
 * invite link (generated here — no external service). `ticketPng` draws the same ticket on a canvas
 * for group chats.
 */
import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import { fmtDay, fmtTime } from '@/lib/time';
import { cn } from '@/lib/utils';

export interface TicketData {
  roomName: string;
  buildingName: string;
  start: string;
  end: string;
  hostAlias: string;
  url?: string;
}

/** "8:00 – 9:30 PM" when both ends share AM/PM, so the big number fits a phone. */
export const compactRange = (a: string, b: string) => {
  const [s, e] = [fmtTime(a), fmtTime(b)];
  return s.slice(-2) === e.slice(-2) ? `${s.slice(0, -3)} – ${e}` : `${s} – ${e}`;
};

/** Campus day (yyyy-MM-dd) of an ISO instant. */
const dayOf = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso));

function qrMatrix(text: string) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return { n: qr.getModuleCount(), dark: (r: number, c: number) => qr.isDark(r, c) };
}

export function QrSvg({ text, size = 112, label }: { text: string; size?: number; label: string }) {
  const { d, n } = useMemo(() => {
    const m = qrMatrix(text);
    let p = '';
    for (let r = 0; r < m.n; r++)
      for (let c = 0; c < m.n; c++) if (m.dark(r, c)) p += `M${c} ${r}h1v1h-1z`;
    return { d: p, n: m.n };
  }, [text]);
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`-2 -2 ${n + 4} ${n + 4}`}
      className="shrink-0 rounded-lg bg-white"
      shapeRendering="crispEdges"
    >
      <path d={d} fill="#2b1a0e" />
    </svg>
  );
}

export function Ticket({ t, className }: { t: TicketData; className?: string }) {
  return (
    <article
      aria-label={`Ticket: study session in ${t.roomName}`}
      className={cn(
        'ticket-in relative mx-auto w-full max-w-sm overflow-hidden rounded-3xl bg-surface shadow-[0_24px_48px_-20px_rgb(43_26_14/0.45)]',
        className,
      )}
    >
      <header className="bg-rail px-6 pt-5 pb-6 text-white">
        <p className="text-xs font-semibold tracking-[0.18em] text-white/85 uppercase">
          Study session
        </p>
        <h3 className="mt-1 text-3xl leading-tight font-bold">{t.roomName}</h3>
        <p className="text-sm text-white/90">{t.buildingName}</p>
      </header>
      <div className="px-6 pt-5 pb-4">
        <p className="text-sm font-semibold tracking-wide text-muted uppercase">
          {fmtDay(dayOf(t.start))}
        </p>
        <p className="mt-1 text-[38px] leading-none font-bold whitespace-nowrap tabular sm:text-[44px]">
          {compactRange(t.start, t.end)}
        </p>
        <p className="mt-3 text-sm text-muted">
          Hosted by <span className="font-semibold text-espresso">{t.hostAlias}</span>
        </p>
      </div>
      {/* perforation: two notches + a dashed tear line */}
      <div aria-hidden className="relative h-6">
        <span className="absolute top-0 -left-3 size-6 rounded-full bg-cream" />
        <span className="absolute top-0 -right-3 size-6 rounded-full bg-cream" />
        <span className="absolute inset-x-5 top-1/2 border-t-2 border-dashed border-line" />
      </div>
      <div className="flex items-center gap-4 px-6 pt-3 pb-6">
        {t.url ? (
          <QrSvg text={t.url} label="QR code to join this study session" />
        ) : (
          <div className="size-28 shrink-0 rounded-lg bg-line/60" aria-hidden />
        )}
        <div className="min-w-0 text-sm">
          <p className="font-semibold">Scan to join</p>
          <p className="mt-1 text-muted">Opens FreeRoom with directions and “Add to calendar”.</p>
        </div>
      </div>
    </article>
  );
}

/** Draw the ticket as a 1080×1440 PNG (for group chats). */
export async function ticketPng(t: TicketData & { url: string }): Promise<Blob> {
  const W = 1080;
  const H = 1440;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const font = (px: number, weight = 700) =>
    `${weight} ${px}px "Inter Variable", Inter, system-ui, sans-serif`;
  g.fillStyle = '#faf6f1';
  g.fillRect(0, 0, W, H);
  const x = 90;
  const y = 90;
  const w = W - 180;
  const h = H - 180;
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, h, 56);
  g.clip();
  g.fillStyle = '#ffffff';
  g.fillRect(x, y, w, h);
  const grad = g.createLinearGradient(0, y, 0, y + 330);
  grad.addColorStop(0, '#6a3600');
  grad.addColorStop(0.5, '#7b3f00');
  grad.addColorStop(1, '#9a5b2a');
  g.fillStyle = grad;
  g.fillRect(x, y, w, 330);
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = font(30, 600);
  g.fillText('STUDY SESSION', x + 64, y + 96);
  g.fillStyle = '#ffffff';
  g.font = font(84);
  g.fillText(t.roomName, x + 64, y + 196);
  g.font = font(36, 500);
  g.fillText(t.buildingName, x + 64, y + 258);
  g.fillStyle = '#6b5444';
  g.font = font(32, 600);
  g.fillText(fmtDay(dayOf(t.start)).toUpperCase(), x + 64, y + 420);
  g.fillStyle = '#2b1a0e';
  g.font = font(96);
  g.fillText(compactRange(t.start, t.end), x + 64, y + 530);
  g.fillStyle = '#6b5444';
  g.font = font(34, 500);
  g.fillText(`Hosted by ${t.hostAlias}`, x + 64, y + 600);
  g.fillStyle = '#faf6f1';
  for (const cx of [x, x + w]) {
    g.beginPath();
    g.arc(cx, y + 680, 34, 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = '#e8ddd2';
  g.lineWidth = 6;
  g.setLineDash([22, 16]);
  g.beginPath();
  g.moveTo(x + 60, y + 680);
  g.lineTo(x + w - 60, y + 680);
  g.stroke();
  g.setLineDash([]);
  const { n, dark } = qrMatrix(t.url);
  const qs = 380;
  const cell = qs / (n + 4);
  const qx = x + 64;
  const qy = y + 750;
  g.fillStyle = '#ffffff';
  g.fillRect(qx, qy, qs, qs);
  g.fillStyle = '#2b1a0e';
  for (let r = 0; r < n; r++)
    for (let col = 0; col < n; col++)
      if (dark(r, col))
        g.fillRect(qx + (col + 2) * cell, qy + (r + 2) * cell, cell + 0.5, cell + 0.5);
  g.font = font(44);
  g.fillText('Scan to join', qx + qs + 48, qy + 120);
  g.fillStyle = '#6b5444';
  g.font = font(30, 500);
  g.fillText('Directions + calendar inside', qx + qs + 48, qy + 172);
  g.fillStyle = '#7b3f00';
  g.font = font(34, 700);
  g.fillText('FreeRoom', qx + qs + 48, qy + 330);
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('PNG failed'))), 'image/png'),
  );
}
