// Calendar reminders for kickbacks: a plain .ics file (RFC 5545) the phone's calendar opens.
// Times come from the pool's payout schedule; each event alarms at its start (TRIGGER:PT0M).

const H = 3600e3

/** "Next kickback only" = one time; "Every kickback for 2 weeks" = every interval for 14 days. */
export function reminderTimes(nextAt: number, intervalH: number | null, mode: 'next' | 'two'): number[] {
  if (mode === 'next') return [nextAt]
  const step = (intervalH && intervalH > 0 ? intervalH : 12) * H
  const out: number[] = []
  for (let t = nextAt; t < nextAt + 14 * 24 * H; t += step) out.push(t)
  return out
}

const stamp = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const text = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')

export interface IcsEvent { start: number, title: string, desc: string }

export function buildIcs(events: IcsEvent[], uidSeed: string, now = Date.now()): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Kickback//Reminders//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']
  events.forEach((e, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:kickback-${uidSeed}-${i}-${e.start}@kickback-ecru.vercel.app`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART:${stamp(e.start)}`,
      `DTEND:${stamp(e.start + 10 * 60e3)}`,
      `SUMMARY:${text(e.title)}`,
      `DESCRIPTION:${text(e.desc)}`,
      'URL:https://kickback-ecru.vercel.app',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `DESCRIPTION:${text(e.title)}`,
      'TRIGGER:PT0M',
      'END:VALARM',
      'END:VEVENT',
    )
  })
  lines.push('END:VCALENDAR')
  return lines.join('\r\n') + '\r\n'
}
