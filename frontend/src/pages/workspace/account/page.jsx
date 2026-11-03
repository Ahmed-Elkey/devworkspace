import React from 'react'
import './../acct.css'
import Doc from '../../../app/Doc.jsx'
import Body from './body.html?raw'
import PageScriptRaw from './page.js.txt?raw'
import ShellScriptRaw from '../../../app/shell.js.txt?raw'

const seg = t => t.split('/*@@BLOCK@@*/').map(s => s.trim()).filter(Boolean)
const scripts = [seg(PageScriptRaw), seg(ShellScriptRaw)]

export default function Page() {
  return <Doc body={Body} scripts={scripts} />
}
