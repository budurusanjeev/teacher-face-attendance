import dynamic from "next/dynamic";

const OfficeApp = dynamic(
  () => import("@/components/office/office-app").then((m) => m.OfficeApp),
  {
    ssr: false,
    loading: () => (
      <div className="flex min-h-full flex-1 items-center justify-center text-sm text-muted-foreground">
        Opening office…
      </div>
    ),
  },
);

export default function OfficePage() {
  return <OfficeApp />;
}
