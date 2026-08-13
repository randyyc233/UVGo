import { ArrowRight, BusFront, CheckCircle2, Clock3, MapPin, ShieldCheck, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, StatusBadge } from '../../components/ui';

const roleLinks = [
  {
    title: 'Passenger shell',
    description: 'Top navigation, mobile booking patterns, and passenger bottom navigation.',
    href: '/passenger/home',
    icon: UsersRound,
  },
  {
    title: 'Driver shell',
    description: 'Queue-first mobile navigation and responsive driver operations layout.',
    href: '/driver/dashboard',
    icon: BusFront,
  },
  {
    title: 'Dispatcher shell',
    description: 'Dense desktop sidebar shell with operational mobile navigation.',
    href: '/dispatcher/dashboard',
    icon: MapPin,
  },
];

export function PublicFoundationPage() {
  return (
    <div className="mx-auto max-w-app px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <section className="overflow-hidden rounded-[1.5rem] border border-border bg-gradient-to-br from-primary-deeper via-primary-dark to-primary p-6 text-text-inverse shadow-floating sm:p-9 lg:grid lg:grid-cols-[1.4fr_0.8fr] lg:items-end lg:gap-8 lg:p-12">
        <div>
          <StatusBadge tone="success" className="border-white/20 bg-white/10 text-white">Phase 3 complete</StatusBadge>
          <h1 className="mt-5 max-w-3xl text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
            A secure UVGo foundation, ready for public journeys.
          </h1>
          <p className="mt-5 max-w-2xl text-sm leading-7 text-white/80 sm:text-base">
            The mockup-derived interface now sits on a complete MySQL domain model, seeded demo data,
            and backend-enforced authentication for every UVGo role.
          </p>
        </div>
        <div className="mt-8 grid grid-cols-2 gap-3 lg:mt-0">
          <div className="rounded-card border border-white/15 bg-white/10 p-4 backdrop-blur">
            <ShieldCheck className="h-6 w-6" aria-hidden="true" />
            <p className="mt-5 text-2xl font-extrabold">12</p>
            <p className="mt-1 text-xs text-white/70">Related data models</p>
          </div>
          <div className="rounded-card border border-white/15 bg-white/10 p-4 backdrop-blur">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
            <p className="mt-5 text-2xl font-extrabold">3</p>
            <p className="mt-1 text-xs text-white/70">Protected user roles</p>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Interface foundations</p>
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight">Preview each responsive shell</h2>
          </div>
          <Clock3 className="hidden h-6 w-6 text-text-muted sm:block" aria-hidden="true" />
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {roleLinks.map((role) => {
            const Icon = role.icon;
            return (
              <Card key={role.href} elevated className="flex flex-col">
                <span className="flex h-11 w-11 items-center justify-center rounded-control bg-primary-soft text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-lg font-bold">{role.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-6 text-text-secondary">{role.description}</p>
                <Link
                  to={role.href}
                  className="mt-5 inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-control border border-primary px-5 py-2.5 text-sm font-semibold text-primary-dark transition-colors hover:bg-primary-soft"
                >
                  Open shell
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </Card>
            );
          })}
        </div>
      </section>

      <Card className="mt-8" elevated>
        <CardHeader title="Phase boundary" description="Feature pages will now be implemented on top of this shared foundation." />
        <div className="grid gap-3 text-sm text-text-secondary sm:grid-cols-3">
          <p className="rounded-control bg-background p-3"><strong className="block text-text-primary">Next: Phase 4</strong>Public hero and departure status board using the supplied hero asset.</p>
          <p className="rounded-control bg-background p-3"><strong className="block text-text-primary">Then: Phase 5</strong>The complete Goa-only passenger reservation and payment flow.</p>
          <p className="rounded-control bg-background p-3"><strong className="block text-text-primary">Protected scope</strong>Role pages now require a valid backend session and matching API authorization.</p>
        </div>
      </Card>
    </div>
  );
}
