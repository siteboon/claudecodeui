/**
 * On-demand Prism language registration for the chat markdown view.
 *
 * `react-syntax-highlighter`'s default `Prism` export pulls in refractor/all —
 * every Prism grammar (1.2MB+) — even though chat output uses a few dozen
 * languages. `PrismLight` starts with zero grammars; this module registers a
 * generous working set (aliases come along with each grammar) and exposes a
 * runtime guard so unregistered fence languages fall back to plain rendering
 * instead of refractor's "Unknown language" throw.
 */

import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter';
import { refractor } from 'refractor/core';
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import graphql from 'react-syntax-highlighter/dist/esm/languages/prism/graphql';
import groovy from 'react-syntax-highlighter/dist/esm/languages/prism/groovy';
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin';
import lua from 'react-syntax-highlighter/dist/esm/languages/prism/lua';
import makefile from 'react-syntax-highlighter/dist/esm/languages/prism/makefile';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import nginx from 'react-syntax-highlighter/dist/esm/languages/prism/nginx';
import objectivec from 'react-syntax-highlighter/dist/esm/languages/prism/objectivec';
import perl from 'react-syntax-highlighter/dist/esm/languages/prism/perl';
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php';
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell';
import protobuf from 'react-syntax-highlighter/dist/esm/languages/prism/protobuf';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import r from 'react-syntax-highlighter/dist/esm/languages/prism/r';
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import scala from 'react-syntax-highlighter/dist/esm/languages/prism/scala';
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss';
import shellSession from 'react-syntax-highlighter/dist/esm/languages/prism/shell-session';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import vim from 'react-syntax-highlighter/dist/esm/languages/prism/vim';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';

const registeredLanguages = [
  bash, c, cpp, csharp, css, diff, docker, go, graphql, groovy, ini, java,
  javascript, json, jsx, kotlin, lua, makefile, markdown, markup, nginx,
  objectivec, perl, php, powershell, protobuf, python, r, ruby, rust, scala,
  scss, shellSession, sql, swift, toml, tsx, typescript, vim, yaml,
];

for (const language of registeredLanguages) {
  SyntaxHighlighter.registerLanguage(language.displayName, language);
}

export { SyntaxHighlighter };

/** True when the fence language (or an alias of it) has a registered grammar. */
export function isRegisteredLanguage(language: string): boolean {
  return refractor.registered(language);
}
