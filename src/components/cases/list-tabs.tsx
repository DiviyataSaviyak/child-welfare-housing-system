import Link from "next/link";

export type ListTab = { key: string; label: string; href: string; current: boolean };

/**
 * A list's tabs, each a link with its count (HOME-2, AMD-9). `apart` is a second group, set apart under a
 * label of its own, such as the DS's amendment tabs beside its case tabs.
 */
export function ListTabs({
  label,
  tabs,
  apart,
}: {
  label: string;
  tabs: ListTab[];
  apart?: { label: string; tabs: ListTab[] };
}) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <TabGroup tabs={tabs} />
      {apart && (
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-semibold text-muted-foreground">{apart.label}</span>
          <TabGroup tabs={apart.tabs} />
        </div>
      )}
    </nav>
  );
}

function TabGroup({ tabs }: { tabs: ListTab[] }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={tab.current ? "page" : undefined}
          className={`flex h-10.5 items-center rounded-md px-4.5 font-semibold whitespace-nowrap ${
            tab.current ? "bg-card text-primary shadow-sm" : "text-soft-foreground"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
