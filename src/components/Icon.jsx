// Tiny inline icon set (no external assets).
const P = {
  dashboard: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z',
  intent: 'M9 2h6a1 1 0 011 1v1h3a1 1 0 011 1v15a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1h3V3a1 1 0 011-1zm1 2v2h4V4h-4zm-2 7h8v2H8v-2zm0 4h8v2H8v-2z',
  cart: 'M7 18a2 2 0 100 4 2 2 0 000-4zm10 0a2 2 0 100 4 2 2 0 000-4zM1 2v2h2l3.6 7.6-1.4 2.4A2 2 0 007 17h12v-2H7.4l1.1-2h7.5a2 2 0 001.8-1l3.6-6.5A1 1 0 0020.5 4H5.2l-.9-2H1z',
  box: 'M21 7.5l-9-5-9 5v9l9 5 9-5v-9zM12 4.3l6.5 3.6L12 11.5 5.5 7.9 12 4.3zM5 9.6l6 3.3v6.5l-6-3.3V9.6zm8 9.8v-6.5l6-3.3v6.5l-6 3.3z',
  inbox: 'M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm0 12h-4a3 3 0 01-6 0H5V5h14v10z',
  db: 'M12 3C7 3 3 4.3 3 6v12c0 1.7 4 3 9 3s9-1.3 9-3V6c0-1.7-4-3-9-3zm0 2c4 0 7 .9 7 1s-3 1-7 1-7-.9-7-1 3-1 7-1zm7 13c0 .1-3 1-7 1s-7-.9-7-1v-2.2c1.7.8 4.2 1.2 7 1.2s5.3-.4 7-1.2V18zm0-5c0 .1-3 1-7 1s-7-.9-7-1v-2.2c1.7.8 4.2 1.2 7 1.2s5.3-.4 7-1.2V13z',
  folder: 'M10 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V8a2 2 0 00-2-2h-8l-2-2z',
  gear: 'M19.4 13a7.7 7.7 0 000-2l2.1-1.6a.5.5 0 00.1-.6l-2-3.5a.5.5 0 00-.6-.2l-2.5 1a7.3 7.3 0 00-1.7-1l-.4-2.6a.5.5 0 00-.5-.4h-4a.5.5 0 00-.5.4l-.4 2.6a7.3 7.3 0 00-1.7 1l-2.5-1a.5.5 0 00-.6.2l-2 3.5a.5.5 0 00.1.6L4.6 11a7.7 7.7 0 000 2l-2.1 1.6a.5.5 0 00-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.2.4.5.4h4c.3 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 00-.1-.6L19.4 13zM12 15.5a3.5 3.5 0 110-7 3.5 3.5 0 010 7z',
  chart: 'M5 9h3v10H5V9zm5-5h3v15h-3V4zm5 8h3v7h-3v-7z',
  menu: 'M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z',
  close: 'M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.300 19.7 2.900 18.3 9.200 12 2.900 5.700 4.300 4.300l6.300 6.300 6.300-6.300 1.4 1.4z',
  chevron: 'M9 6l6 6-6 6',
  logout: 'M16 17v-3H9v-4h7V7l5 5-5 5zM14 2a2 2 0 012 2v2h-2V4H5v16h9v-2h2v2a2 2 0 01-2 2H5a2 2 0 01-2-2V4a2 2 0 012-2h9z',
  key: 'M12.7 10A5 5 0 103 12a5 5 0 009.7 2H16v3h3v-3h2v-4h-8.3zM8 14a2 2 0 110-4 2 2 0 010 4z',
  download: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
  plus: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  search: 'M15.5 14h-.8l-.3-.3A6.500 6.500 0 109.5 16a6.500 6.500 0 004.2-1.600l.3.3v.8l5 5 1.500-1.500-5-5zm-6 0a4.500 4.500 0 110-9 4.500 4.500 0 010 9z',
};
export default function Icon({ name, className = 'h-5 w-5', stroke = false }) {
  if (stroke) return <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={P[name]} /></svg>;
  return <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true"><path d={P[name]} /></svg>;
}
