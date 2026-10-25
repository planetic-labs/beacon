const paths = {
  plus: "M12 5v14M5 12h14",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87",
  chats: "M4 4h16v13H9l-5 4V4ZM12 4v13",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2",
  back: "M19 12H5M11 6l-6 6 6 6",
  refresh:
    "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  menu: "M4 12h.01M12 12h.01M20 12h.01",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4",
  bellOff: "M3 3l18 18M6 6c-1 5 0 8-3 11h14M10 21h4M10 2a6 6 0 0 1 8 6c0 2 0 4 1 6",
};
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
      {name === "users" && <circle cx="9" cy="7" r="4" />}
    </svg>
  );
}
