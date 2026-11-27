import { getOpenViewerFacts } from '../lib/openViewerFacts.js';
import { Card, CardTitle, OverlayTrigger } from './Shell.jsx';

export default function PropertyFacts({ slug }) {
  const facts = getOpenViewerFacts(slug);
  if (!facts) return null;

  return (
    <>
      <dl aria-label="Building facts" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {facts.building.stats.map((stat) => (
          <div key={stat.key} className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_0_rgba(20,33,61,0.04)]">
            <dt className="text-xs font-medium uppercase tracking-[0.12em] text-ink-soft">{stat.label}</dt>
            <dd className="mt-1.5 font-display text-xl font-semibold leading-tight text-ink sm:text-2xl">
              <OverlayTrigger label={`${stat.label} source`} lines={facts.building.sources}>
                {stat.value}
              </OverlayTrigger>
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle
            aside={(
              <OverlayTrigger
                label="Neighborhood source"
                lines={facts.neighborhood.sources}
                className="text-sm font-medium text-ink-soft"
              >
                {facts.neighborhood.name}
              </OverlayTrigger>
            )}
          >
            Neighborhood
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <OverlayTrigger
              label="Walk Score source"
              lines={facts.neighborhood.sources}
              className="inline-flex items-center rounded-full bg-good/10 px-3 py-1 text-xs font-semibold text-good"
            >
              {`${facts.neighborhood.walkScore.label} · ${facts.neighborhood.walkScore.rating}`}
            </OverlayTrigger>
            <OverlayTrigger
              label="Transit Score source"
              lines={facts.neighborhood.sources}
              className="inline-flex items-center rounded-full bg-warm-soft px-3 py-1 text-xs font-semibold text-ink"
            >
              {facts.neighborhood.transitScore.label}
            </OverlayTrigger>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-ink">
            <OverlayTrigger label="Neighborhood details source" lines={facts.neighborhood.sources}>
              {facts.neighborhood.highlight}
            </OverlayTrigger>
          </p>
        </Card>

        <Card>
          <CardTitle
            aside={(
              <OverlayTrigger
                label="School district source"
                lines={facts.schools.sources}
                className="rounded-full bg-warm-soft px-2.5 py-0.5 text-xs font-medium text-ink"
              >
                {facts.schools.district}
              </OverlayTrigger>
            )}
          >
            Schools
          </CardTitle>
          <ul className="divide-y divide-line">
            {facts.schools.list.map((school) => (
              <li key={school} className="py-2.5 text-sm font-medium text-ink first:pt-0 last:pb-0">
                <OverlayTrigger label="School assignment source" lines={facts.schools.sources}>
                  {school}
                </OverlayTrigger>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {(facts.nearby || facts.map) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {facts.nearby && (
            <Card>
              <CardTitle>Nearby</CardTitle>
              <div className="space-y-5">
                {[['Walk', facts.nearby.walk], ['Drive', facts.nearby.drive]].map(([groupLabel, places]) => (
                  <div key={groupLabel}>
                    <h3 className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-ink-soft">
                      {groupLabel}
                    </h3>
                    <ul className="divide-y divide-line">
                      {places.map((place) => (
                        <li key={place.name} className="flex items-baseline justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0">
                          <span className="min-w-0 font-medium text-ink">{place.name}</span>
                          <OverlayTrigger
                            label={`${place.name} distance source`}
                            lines={facts.nearby.sources}
                            className="shrink-0 whitespace-nowrap text-right text-ink-soft tabular-nums"
                          >
                            {`${place.distance} · ${place.time}`}
                          </OverlayTrigger>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
                <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-soft">
                  {facts.nearby.transit.label}
                </span>
                {facts.nearby.transit.routes.map((route) => (
                  <OverlayTrigger
                    key={route}
                    label={`${route} transit source`}
                    lines={facts.nearby.transit.sources}
                    className="inline-flex items-center rounded-full bg-warm-soft px-3 py-1 text-xs font-semibold text-ink"
                  >
                    {route}
                  </OverlayTrigger>
                ))}
              </div>
            </Card>
          )}

          {facts.map && (
            <Card className="flex flex-col">
              <CardTitle
                aside={(
                  <a
                    href={facts.map.directionsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[40px] items-center justify-center rounded-xl bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-soft"
                  >
                    Get directions
                  </a>
                )}
              >
                Map
              </CardTitle>
              <div className="flex-1 overflow-hidden rounded-xl border border-line bg-warm-soft/30">
                <iframe
                  src={facts.map.embedUrl}
                  title="Map"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="block h-[280px] w-full border-0 sm:h-[340px] lg:h-full lg:min-h-[340px]"
                />
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
