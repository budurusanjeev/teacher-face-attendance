import dynamic from "next/dynamic";

const GateView = dynamic(
  () => import("@/components/kiosk/gate-view").then((m) => m.GateView),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-full flex-1 items-center justify-center bg-[#0b1f17] text-emerald-50">
        Starting gate camera…
      </div>
    ),
  },
);

export default function HomePage() {
  return <GateView />;
}
