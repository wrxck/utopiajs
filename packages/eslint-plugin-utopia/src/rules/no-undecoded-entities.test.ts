import { RuleTester } from 'eslint';

import * as parser from '../parser';
import rule from './no-undecoded-entities';

const ruleTester = new RuleTester({
  languageOptions: {
    parser,
    parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
});

ruleTester.run('no-undecoded-entities', rule, {
  valid: [
    // entities the compiler decodes are fine.
    { code: '<template><p>a &times; b &mdash; c &nbsp;d</p></template>', filename: 'a.utopia' },
    // numeric references are always decoded, so never flagged.
    { code: '<template><p>minus &#8722; here</p></template>', filename: 'a.utopia' },
    // an ampersand that is not an entity must not trip the scan.
    { code: '<template><p>Tom &amp; Jerry, fish & chips</p></template>', filename: 'a.utopia' },
    // entities only matter in the template, not the script.
    {
      code: '<template><p>ok</p></template>\n<script lang="ts">const s = "&minus;";</script>',
      filename: 'a.utopia',
    },
    // a component without a template block has nothing to scan.
    { code: '<script lang="ts">export const x = 1;</script>', filename: 'a.utopia' },
  ],
  invalid: [
    {
      code: '<template><p>Temp &minus; 5</p></template>',
      filename: 'a.utopia',
      errors: [{ messageId: 'undecoded', data: { name: 'minus' } }],
    },
    {
      code: '<template><p>&minus; and &frac12; and &deg;</p></template>',
      filename: 'a.utopia',
      errors: [
        { messageId: 'undecoded', data: { name: 'minus' } },
        { messageId: 'undecoded', data: { name: 'frac12' } },
        { messageId: 'undecoded', data: { name: 'deg' } },
      ],
    },
  ],
});
