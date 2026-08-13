import { useEffect, useState } from 'react';

const heroSlides = [
  {
    src: '/assets/hero/hero-naga-porta-mariae.jpg',
    alt: 'Porta Mariae in Naga City',
  },
  {
    src: '/assets/hero/hero-naga-penafrancia-basilica.jpg',
    alt: 'Peñafrancia Basilica in Naga City',
  },
  {
    src: '/assets/hero/hero-legazpi-mayon.jpg',
    alt: 'Mayon Volcano in Legazpi, Albay',
  },
  {
    src: '/assets/hero/hero-legazpi-cagsawa-ruins.jpg',
    alt: 'Cagsawa Ruins with Mayon Volcano in Albay',
  },
  {
    src: '/assets/hero/hero-legazpi-boulevard.jpg',
    alt: 'Legazpi Boulevard with Mayon Volcano in the distance',
  },
  {
    src: '/assets/hero/hero-goa-st-john-church.jpg',
    alt: 'St. John the Baptist Parish Church in Goa, Camarines Sur',
  },
  {
    src: '/assets/hero/hero-goa-mt-isarog.jpg',
    alt: 'Mt. Isarog-side scenic landscape in Camarines Sur',
  },
] as const;

export function HeroBackgroundSlideshow() {
  const [activeSlide, setActiveSlide] = useState(0);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setActiveSlide((currentSlide) => (currentSlide + 1) % heroSlides.length);
    }, 7000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {heroSlides.map((slide, index) => (
        <img
          key={slide.src}
          src={slide.src}
          alt={slide.alt}
          className={`absolute inset-0 h-full w-full object-cover object-center transition-opacity duration-1000 ${
            index === activeSlide ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ))}
    </div>
  );
}
