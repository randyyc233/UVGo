import {
  BellRing,
  BusFront,
  CheckCircle2,
  Clock3,
  Headphones,
  LockKeyhole,
  MapPin,
  Radio,
  ShieldCheck,
  TicketCheck,
  UsersRound,
} from 'lucide-react';
import { BookingSearchCard } from '../../components/public/BookingSearchCard';
import { DepartureBoard } from '../../components/public/DepartureBoard';
import { HeroBackgroundSlideshow } from '../../components/public/HeroBackgroundSlideshow';
import { RouteCards } from '../../components/public/RouteCards';

const serviceHighlights = [
  { icon: TicketCheck, title: 'Live seat availability', text: 'See open Goa seats before booking.' },
  { icon: ShieldCheck, title: 'Verified departures', text: 'Trusted terminal and trip information.' },
  { icon: Radio, title: 'Queue updates', text: 'See which vans are currently in the queue.' },
  { icon: LockKeyhole, title: 'Secure booking', text: 'Pay with the official PayPal button, then track verification in UVGo.' },
];

const reasons = [
  { icon: BusFront, title: 'Comfortable & reliable', text: 'Organized UV Express departures from NCEBT.' },
  { icon: Clock3, title: 'Clear protocols', text: 'Goso schedules for Goa and Taya loading for Legazpi.' },
  { icon: UsersRound, title: 'Local & trusted', text: 'Designed around Bicolano passengers and operators.' },
  { icon: Headphones, title: 'Here to help', text: 'In-app notices keep important changes visible.' },
];

export function PublicLandingPage() {
  return (
    <div id="top" className="bg-background">
      <section className="relative isolate overflow-hidden bg-primary-deeper">
        <HeroBackgroundSlideshow />
        <div className="absolute inset-0 bg-gradient-to-r from-primary-deeper/95 via-primary-deeper/75 to-primary-deeper/60 lg:via-primary-deeper/60 lg:to-primary-deeper/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-primary-deeper/55 via-transparent to-transparent" />
        <div className="relative mx-auto flex min-h-[31rem] max-w-app items-start px-4 pb-32 pt-12 sm:min-h-[34rem] sm:px-6 sm:pt-16 lg:min-h-[38rem] lg:px-8 lg:pb-36 lg:pt-20">
          <div className="max-w-2xl text-text-inverse">
            <span className="inline-flex items-center gap-2 rounded-pill border border-white/25 bg-white/15 px-3 py-1.5 text-xs font-semibold backdrop-blur">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Travel Bicol with confidence
            </span>
            <h1 className="mt-6 text-4xl font-black leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-7xl">
              Mas Marhay an Biyahe Pag Ready Ka!
            </h1>
            <p className="mt-5 max-w-lg text-sm leading-7 text-white/85 sm:text-base lg:text-lg">
              Check your trip, reserve your seat, and stay updated before you go.
            </p>
            <div className="mt-7 flex flex-wrap gap-3 text-xs font-medium text-white/80">
              <span className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Naga City East Bound Terminal</span>
              <span className="flex items-center gap-2"><BellRing className="h-4 w-4" /> In-app updates</span>
            </div>
          </div>
        </div>
      </section>

      <div className="relative z-10 mx-auto -mt-24 max-w-app px-4 sm:px-6 lg:-mt-24 lg:px-8">
        <BookingSearchCard />
      </div>

      <section className="mx-auto max-w-app px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-3 border-b border-border pb-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
          {serviceHighlights.map((item) => {
            const Icon = item.icon;
            return (
              <article key={item.title} className="flex gap-3 rounded-control bg-surface p-3 sm:p-4 lg:bg-transparent lg:p-0">
                <Icon className="h-6 w-6 shrink-0 text-primary" strokeWidth={1.8} aria-hidden="true" />
                <div className="min-w-0"><h3 className="text-sm font-bold">{item.title}</h3><p className="mt-1 text-xs leading-5 text-text-secondary">{item.text}</p></div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="routes" className="py-6 sm:py-10">
        <div className="mx-auto max-w-app px-4 sm:px-6 lg:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Routes from NCEBT</p>
          <div className="mt-2 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-3xl font-black tracking-tight sm:text-4xl">Two routes, two clear protocols</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-text-secondary sm:text-base">Reserve Goa in advance or follow Legazpi’s live Taya loading status.</p>
            </div>
          </div>
          <div className="mt-6"><RouteCards /></div>
        </div>
      </section>

      <DepartureBoard />

      <section id="why-uvgo" className="border-y border-border bg-surface py-14 sm:py-16">
        <div className="mx-auto max-w-app px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-primary">Why ride with UVGo?</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight">A simpler terminal experience</h2>
          </div>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {reasons.map((reason) => {
              const Icon = reason.icon;
              return (
                <article key={reason.title} className="rounded-card border border-border bg-background p-5">
                  <Icon className="h-8 w-8 text-primary" strokeWidth={1.7} aria-hidden="true" />
                  <h3 className="mt-5 font-bold">{reason.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-text-secondary">{reason.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="bg-primary-deeper py-10 text-white">
        <div className="mx-auto flex max-w-app flex-col justify-between gap-6 px-4 sm:px-6 md:flex-row md:items-center lg:px-8">
          <div>
            <p className="text-2xl font-black tracking-tight">UVGo</p>
            <p className="mt-1 text-xs uppercase tracking-[0.12em] text-white/60">Bicol van dispatch</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/70">
            <a href="#routes" className="inline-flex min-h-touch items-center hover:text-white">Routes</a>
            <a href="#departures" className="inline-flex min-h-touch items-center hover:text-white">Departures</a>
            <a href="#why-uvgo" className="inline-flex min-h-touch items-center hover:text-white">Why UVGo</a>
          </nav>
          <p className="text-xs text-white/60">Naga City East Bound Terminal · Web app</p>
        </div>
      </footer>
    </div>
  );
}
