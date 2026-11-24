function FileLinks({ files, signedUrls }) {
  if (!files?.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {files.map((f) => {
        const href = signedUrls[f.path];
        if (!href) return null;
        return (
          <a
            key={f.path}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex min-h-[32px] items-center rounded-full border border-line bg-warm-soft/60 px-2.5 py-0.5 text-xs font-medium text-ink hover:border-ink"
          >
            {f.label}
          </a>
        );
      })}
    </div>
  );
}

function SourceOverlay({ source }) {
  if (!source) return null;
  return (
    <div
      role="tooltip"
      onClick={(e) => e.stopPropagation()}
      className="absolute left-0 right-0 top-full z-30 mt-1.5 max-w-md rounded-xl border border-line bg-ink p-3 text-xs text-white shadow-lg"
    >
      <div className="font-medium">
        {source.sourceUrl ? (
          <a
            href={source.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-warm-soft"
          >
            {source.sourceName}
          </a>
        ) : (
          source.sourceName
        )}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-white/85">
        <span>Document date: {source.documentDate || 'Not stated'}</span>
        <span>Retrieved: {source.retrievedAt}</span>
      </div>
      {source.unverified && (
        <span className="mt-1.5 inline-block rounded-full bg-amber-300/20 px-2 py-0.5 text-[11px] font-medium text-amber-200">
          Unverified
        </span>
      )}
    </div>
  );
}

const SectionCard = ({ title, children }) => (
  <section className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_0_rgba(20,33,61,0.04)] sm:p-5">
    {title && <h2 className="mb-4 font-display text-xl font-semibold">{title}</h2>}
    {children}
  </section>
);

export default function CityRecordsView({
  data,
  signedUrls = {},
  activeId = null,
  onHover,
  onLeave,
  onToggle,
}) {
  const summary = data?.summary || [];
  const agencies = data?.agencies || [];

  if (!summary.length && !agencies.length) {
    return (
      <SectionCard>
        <p className="text-sm text-ink-soft">No city records.</p>
      </SectionCard>
    );
  }

  const handlers = (item) => ({
    tabIndex: 0,
    onPointerEnter: (e) => {
      if (e.pointerType === 'mouse') onHover?.(item.id);
    },
    onPointerLeave: (e) => {
      if (e.pointerType === 'mouse') onLeave?.(item.id);
    },
    onClick: () => onToggle?.(item.id),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle?.(item.id);
      } else if (e.key === 'Escape') {
        onLeave?.(null);
      }
    },
  });

  return (
    <div className="space-y-4">
      {summary.length > 0 && (
        <SectionCard title="Summary">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {summary.map((item) => (
              <div
                key={item.id}
                {...handlers(item)}
                className="relative cursor-pointer rounded-xl border border-line bg-paper/60 p-3 outline-none transition hover:border-ink focus-visible:ring-2 focus-visible:ring-warm"
              >
                <div className="text-xs font-medium text-ink-soft">{item.label}</div>
                <div className="mt-0.5 break-words text-sm font-medium text-ink">{item.value}</div>
                <FileLinks files={item.files} signedUrls={signedUrls} />
                {activeId === item.id && <SourceOverlay source={item.source} />}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {agencies.map((ag) => (
        <SectionCard key={ag.id || ag.agency} title={ag.agency}>
          <ul className="divide-y divide-line">
            {(ag.items || []).map((item) => (
              <li
                key={item.id}
                {...handlers(item)}
                className="relative cursor-pointer rounded-lg py-2.5 outline-none first:pt-0 last:pb-0 focus-visible:ring-2 focus-visible:ring-warm"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <span className="shrink-0 text-sm font-medium text-ink sm:w-64">{item.label}</span>
                  <div className="min-w-0 flex-1">
                    <div className="break-words text-sm text-ink">{item.value}</div>
                    <FileLinks files={item.files} signedUrls={signedUrls} />
                  </div>
                </div>
                {activeId === item.id && <SourceOverlay source={item.source} />}
              </li>
            ))}
          </ul>
        </SectionCard>
      ))}
    </div>
  );
}
