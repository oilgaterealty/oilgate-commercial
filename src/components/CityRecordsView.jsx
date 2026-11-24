import { useState } from 'react';
import { answerTone, organizeCityRecords } from '../lib/cityRecords.js';

const LIST_CAP = 5;

const TONE_TEXT = {
  good: 'text-good',
  warn: 'text-amber-700',
  neutral: 'text-ink',
};

const TONE_CARD = {
  good: 'border-line bg-paper/60',
  warn: 'border-amber-300 bg-amber-50/40',
  neutral: 'border-line bg-paper/60',
};

function FileLinks({ files, signedUrls }) {
  const visible = (files || []).filter((f) => Boolean(signedUrls[f.path]));
  if (!visible.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((f) => (
        <a
          key={f.path}
          href={signedUrls[f.path]}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-ink-soft active:scale-[0.97]"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M5 2.5h6.5L15 6v11.5H5z" /><path d="M11.5 2.5V6H15" /></svg>
          <span>{f.label}</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 4h8v8" /><path d="M16 4 6 14" /></svg>
        </a>
      ))}
    </div>
  );
}

function SourceButton({ item, activeId, onToggle }) {
  if (!item.sources?.length) return null;
  const open = activeId === item.id;
  return (
    <button
      type="button"
      aria-label={`Source details for ${item.label}`}
      aria-expanded={open}
      onClick={(e) => {
        e.stopPropagation();
        onToggle?.(item.id);
      }}
      className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded-full border border-line bg-paper px-2 text-xs font-semibold text-ink-soft hover:border-ink hover:text-ink"
    >
      &#9432;
    </button>
  );
}

function DetailsList({ listKey, details, expandedLists, onToggleList }) {
  if (!details?.length) return null;
  const showAll = expandedLists.has(listKey);
  const visible = showAll ? details : details.slice(0, LIST_CAP);
  const hiddenCount = details.length - LIST_CAP;
  return (
    <div>
      <ul className="list-disc space-y-1 pl-4 text-sm text-ink">
        {visible.map((detail, idx) => (
          <li key={idx} className="break-words">{detail}</li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleList(listKey);
          }}
          className="mt-1.5 text-xs font-semibold text-ink-soft underline underline-offset-2 hover:text-ink"
        >
          {showAll ? 'Show fewer' : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}

function SourceOverlay({ sources }) {
  if (!sources?.length) return null;
  return (
    <div
      role="tooltip"
      onClick={(e) => e.stopPropagation()}
      className="absolute left-0 right-0 top-full z-30 max-h-72 max-w-md overflow-y-auto break-words rounded-xl border border-line bg-ink p-3 text-xs text-white shadow-lg"
    >
      {sources.map((source, index) => (
        <div key={index} className="border-white/20 py-2 first:pt-0 last:pb-0 [&+div]:border-t">
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
      ))}
    </div>
  );
}

const Chevron = ({ open }) => (
  <svg aria-hidden="true" viewBox="0 0 20 20" className={`h-5 w-5 shrink-0 text-ink transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 8 5 5 5-5" /></svg>
);

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
  expandedIds,
}) {
  const [localExpanded, setLocalExpanded] = useState(() => new Set());
  const [expandedLists, setExpandedLists] = useState(() => new Set());
  const { summary, groups } = organizeCityRecords(data);

  if (!summary.length && !groups.length) {
    return (
      <SectionCard>
        <p className="text-sm text-ink-soft">No city records.</p>
      </SectionCard>
    );
  }

  const isExpanded = (id) => {
    if (localExpanded.has(id)) return true;
    if (!expandedIds) return false;
    return expandedIds instanceof Set ? expandedIds.has(id) : expandedIds.includes(id);
  };

  const toggleExpand = (id) => {
    const currentlyExpanded = localExpanded.has(id);
    setLocalExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (currentlyExpanded && activeId === id) {
      onLeave?.(null);
    }
  };

  const toggleList = (listKey) => {
    setExpandedLists((prev) => {
      const next = new Set(prev);
      if (next.has(listKey)) next.delete(listKey);
      else next.add(listKey);
      return next;
    });
  };

  const handlers = (item) => ({
    tabIndex: 0,
    onPointerEnter: (e) => {
      if (e.pointerType === 'mouse') onHover?.(item.id);
    },
    onPointerLeave: (e) => {
      if (e.pointerType === 'mouse') onLeave?.(item.id);
    },
    onClick: () => toggleExpand(item.id),
    onKeyDown: (e) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleExpand(item.id);
      } else if (e.key === 'Escape') {
        onLeave?.(null);
      }
    },
  });

  const hasFiles = (item) => (item.files || []).some((f) => Boolean(signedUrls[f.path]));
  const canExpand = (item) => Boolean(item.details?.length) || hasFiles(item) || Boolean(item.sources?.length);

  return (
    <div className="space-y-4">
      {summary.length > 0 && (
        <SectionCard title="What matters">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
            {summary.map((item) => {
              const expanded = isExpanded(item.id);
              const tone = answerTone(item.label, item.answer);
              const showFooter = hasFiles(item) || Boolean(item.sources?.length);
              return (
                <div
                  key={item.id}
                  {...handlers(item)}
                  aria-expanded={expanded}
                  className={`relative cursor-pointer rounded-xl border p-3 outline-none transition hover:border-ink focus-visible:ring-2 focus-visible:ring-warm ${
                    expanded ? 'col-span-full bg-white' : TONE_CARD[tone]
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-semibold text-ink-soft">{item.label}</div>
                    {canExpand(item) && <Chevron open={expanded} />}
                  </div>
                  <div className={`mt-1 break-words text-2xl font-bold leading-tight ${TONE_TEXT[tone]}`}>
                    {item.answer}
                  </div>
                  {item.line && (
                    <div className="mt-1 break-words text-sm font-medium leading-snug text-ink">{item.line}</div>
                  )}
                  {expanded && (
                    <div className="mt-2.5 space-y-2.5 border-t border-line pt-2.5">
                      <DetailsList
                        listKey={`card:${item.id}`}
                        details={item.details}
                        expandedLists={expandedLists}
                        onToggleList={toggleList}
                      />
                      {showFooter && (
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <FileLinks files={item.files} signedUrls={signedUrls} />
                          <SourceButton item={item} activeId={activeId} onToggle={onToggle} />
                        </div>
                      )}
                    </div>
                  )}
                  {activeId === item.id && <SourceOverlay sources={item.sources} />}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {groups.map((group) => {
        const listKey = `group:${group.id}`;
        const showAll = expandedLists.has(listKey);
        const visibleItems = showAll ? group.items : group.items.slice(0, LIST_CAP);
        const hiddenCount = group.items.length - LIST_CAP;
        return (
          <details
            key={group.id}
            open={['ownership', 'liens', 'taxes', 'offline'].includes(group.id)}
            className="group rounded-xl border border-line bg-white px-3 sm:px-4"
          >
            <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-3 py-2 text-lg font-semibold text-ink [&::-webkit-details-marker]:hidden">
              <span>
                {group.label} <span className="ml-1 tabular-nums text-ink-soft">({group.count})</span>
              </span>
              <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5 shrink-0 text-ink transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 8 5 5 5-5" /></svg>
            </summary>
            <ul className="divide-y divide-line pb-2">
              {visibleItems.map((item) => {
                const expanded = isExpanded(item.id);
                const tone = answerTone(item.label, item.answer);
                const showFooter = hasFiles(item) || Boolean(item.sources?.length);
                return (
                  <li
                    key={item.id}
                    {...handlers(item)}
                    aria-expanded={expanded}
                    className="relative cursor-pointer rounded-lg py-2.5 outline-none first:pt-0 last:pb-0 focus-visible:ring-2 focus-visible:ring-warm"
                  >
                    {group.id === 'offline' ? (
                      <div>
                        <div className="break-words text-base font-semibold text-ink">{item.label}</div>
                        <div className="mt-0.5 break-words text-sm text-ink">Ask {item.value}</div>
                        {expanded && showFooter && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                            <FileLinks files={item.files} signedUrls={signedUrls} />
                            <SourceButton item={item} activeId={activeId} onToggle={onToggle} />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="break-words text-sm font-medium text-ink-soft">{item.label}</div>
                            <div className={`mt-0.5 break-words text-base font-semibold leading-snug ${TONE_TEXT[tone]}`}>
                              {item.answer}
                            </div>
                          </div>
                          {canExpand(item) && <Chevron open={expanded} />}
                        </div>
                        {expanded && (item.details?.length > 0 || showFooter) && (
                          <div className="mt-2 space-y-2 border-t border-line/70 pt-2">
                            <DetailsList
                              listKey={`row:${item.id}`}
                              details={item.details}
                              expandedLists={expandedLists}
                              onToggleList={toggleList}
                            />
                            {showFooter && (
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <FileLinks files={item.files} signedUrls={signedUrls} />
                                <SourceButton item={item} activeId={activeId} onToggle={onToggle} />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                    {activeId === item.id && <SourceOverlay sources={item.sources} />}
                  </li>
                );
              })}
            </ul>
            {hiddenCount > 0 && (
              <div className="pb-3 pt-1">
                <button
                  type="button"
                  onClick={() => toggleList(listKey)}
                  className="inline-flex min-h-[44px] items-center rounded-lg border border-line bg-paper px-4 text-sm font-semibold text-ink hover:border-ink active:scale-[0.97]"
                >
                  {showAll ? 'Show fewer' : `Show ${hiddenCount} more`}
                </button>
              </div>
            )}
          </details>
        );
      })}
    </div>
  );
}
