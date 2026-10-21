import { ExampleCommitment } from '../components/landing/ExampleCommitment';
import { Faq } from '../components/landing/Faq';
import { FinalCta } from '../components/landing/FinalCta';
import { Hero } from '../components/landing/Hero';
import { HowItWorks } from '../components/landing/HowItWorks';
import { WhyThisExists } from '../components/landing/WhyThisExists';

export function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <ExampleCommitment />
      <WhyThisExists />
      <Faq />
      <FinalCta />
    </>
  );
}
