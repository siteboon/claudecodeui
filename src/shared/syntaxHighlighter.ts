import { PrismLight } from 'react-syntax-highlighter';

import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash';
import batch from 'react-syntax-highlighter/dist/esm/languages/prism/batch';
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c';
import clike from 'react-syntax-highlighter/dist/esm/languages/prism/clike';
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp';
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp';
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css';
import dart from 'react-syntax-highlighter/dist/esm/languages/prism/dart';
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff';
import docker from 'react-syntax-highlighter/dist/esm/languages/prism/docker';
import elixir from 'react-syntax-highlighter/dist/esm/languages/prism/elixir';
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go';
import graphql from 'react-syntax-highlighter/dist/esm/languages/prism/graphql';
import groovy from 'react-syntax-highlighter/dist/esm/languages/prism/groovy';
import haskell from 'react-syntax-highlighter/dist/esm/languages/prism/haskell';
import hcl from 'react-syntax-highlighter/dist/esm/languages/prism/hcl';
import ini from 'react-syntax-highlighter/dist/esm/languages/prism/ini';
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java';
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript';
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json';
import json5 from 'react-syntax-highlighter/dist/esm/languages/prism/json5';
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx';
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin';
import less from 'react-syntax-highlighter/dist/esm/languages/prism/less';
import lua from 'react-syntax-highlighter/dist/esm/languages/prism/lua';
import makefile from 'react-syntax-highlighter/dist/esm/languages/prism/makefile';
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown';
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup';
import nginx from 'react-syntax-highlighter/dist/esm/languages/prism/nginx';
import objectivec from 'react-syntax-highlighter/dist/esm/languages/prism/objectivec';
import perl from 'react-syntax-highlighter/dist/esm/languages/prism/perl';
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php';
import powershell from 'react-syntax-highlighter/dist/esm/languages/prism/powershell';
import properties from 'react-syntax-highlighter/dist/esm/languages/prism/properties';
import protobuf from 'react-syntax-highlighter/dist/esm/languages/prism/protobuf';
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python';
import r from 'react-syntax-highlighter/dist/esm/languages/prism/r';
import regex from 'react-syntax-highlighter/dist/esm/languages/prism/regex';
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby';
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust';
import scala from 'react-syntax-highlighter/dist/esm/languages/prism/scala';
import scss from 'react-syntax-highlighter/dist/esm/languages/prism/scss';
import solidity from 'react-syntax-highlighter/dist/esm/languages/prism/solidity';
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql';
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift';
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml';
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx';
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript';
import vim from 'react-syntax-highlighter/dist/esm/languages/prism/vim';
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml';
import zig from 'react-syntax-highlighter/dist/esm/languages/prism/zig';

/**
 * The syntax highlighter chat code blocks render through.
 *
 * `react-syntax-highlighter`'s default Prism export bundles every language
 * Prism ships — around 290 of them. That is roughly a quarter of the app's
 * JavaScript, and registering them costs a depth-first walk of the whole
 * grammar table on startup, which profiles as the single most expensive thing
 * the client does before it can paint.
 *
 * These are the languages a coding agent actually emits fences for. Anything
 * outside the list still renders — refractor throws on an unknown grammar and
 * the highlighter falls back to plain text — it simply is not coloured. Each
 * grammar registers its own aliases, so `sh`, `yml`, `py` and friends resolve
 * without being listed separately.
 */
const LANGUAGES = {
  bash, batch, c, clike, cpp, csharp, css, dart, diff, docker, elixir, go,
  graphql, groovy, haskell, hcl, ini, java, javascript, json, json5, jsx,
  kotlin, less, lua, makefile, markdown, markup, nginx, objectivec, perl, php,
  powershell, properties, protobuf, python, r, regex, ruby, rust, scala, scss,
  solidity, sql, swift, toml, tsx, typescript, vim, yaml, zig,
};

for (const [name, language] of Object.entries(LANGUAGES)) {
  PrismLight.registerLanguage(name, language);
}

export const SyntaxHighlighter = PrismLight;
