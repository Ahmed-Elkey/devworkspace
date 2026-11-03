import React from 'react'
import cssUrl from './../main.css?url'
import Doc from '../../../app/Doc.jsx'
import { usePageStylesheet } from '../../../app/PageStylesheet.jsx'
import Body from './body.html?raw'
import PageScriptRaw from './page.js.txt?raw'
import ShellScriptRaw from '../../../app/shell.js.txt?raw'
import PortalScriptRaw from '../extra.js.txt?raw'

const seg = t => t.split('/*@@BLOCK@@*/').map(s => s.trim()).filter(Boolean)
const scripts = [seg(PageScriptRaw), seg(ShellScriptRaw), seg(PortalScriptRaw)]

export default function Page() {
  usePageStylesheet(cssUrl)
  return <Doc body={Body} scripts={scripts} />
}
