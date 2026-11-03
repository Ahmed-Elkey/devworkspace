import React from 'react'
import PricingApp from './PricingApp.jsx'
import cssUrl from './pricing.css?url'
import { usePageStylesheet } from '../../app/PageStylesheet.jsx'

// The stylesheet rides on the route mount, not on the module import, so it
// leaves when the page does.
export default function PricingAppPage() {
  usePageStylesheet(cssUrl)
  return <PricingApp />
}