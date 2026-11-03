import React from 'react'
import cssUrl from '././loading.css?url'
import Doc from '../../../app/Doc.jsx'
import { usePageStylesheet } from '../../../app/PageStylesheet.jsx'
import Body from './body.html?raw'
import PageScriptRaw from './page.js.txt?raw'
import ShellScriptRaw from '../../../app/shell.js.txt?raw'

const seg = t => t.split('/*@@BLOCK@@*/').map(s => s.trim()).filter(Boolean)
const scripts = [seg(PageScriptRaw), seg(ShellScriptRaw)]

export default function Page() {
  usePageStylesheet(cssUrl)
  return <Doc body={Body} scripts={scripts} />
}
