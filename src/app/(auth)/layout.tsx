export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-8">
      <div className="w-full max-w-md">{children}</div>
      <p className="mt-8 max-w-md text-center text-[11px] leading-relaxed text-gray-400">
        Privates Hobby-Projekt. Nicht verbunden mit LEGO Group, BrickLink
        Limited, BrickOwl LLC oder BrickSync. LEGO®, BrickLink® und BrickOwl®
        sind Marken der jeweiligen Rechteinhaber.
      </p>
    </div>
  );
}
