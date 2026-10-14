import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Linter } from 'eslint';

function contractsOf(path) {
  const contracts = new Map();
  const inspect = {
    create: () => ({
      FunctionDeclaration(node) {
        if (!node.id?.name.startsWith('create') && node.id?.name !== 'bindUiEvents') return;
        const parameter = node.params[0];
        if (parameter?.type !== 'ObjectPattern') return;
        contracts.set(
          node.id.name,
          parameter.properties
            .filter((property) => property.value.type === 'Identifier')
            .map((property) => property.key.name)
        );
      }
    })
  };
  new Linter().verify(readFileSync(path, 'utf8'), [
    {
      languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
      plugins: { contracts: { rules: { inspect } } },
      rules: { 'contracts/inspect': 'error' }
    }
  ]);
  return contracts;
}

export default {
  meta: { type: 'problem', schema: [], messages: { missing: '{{factory}} requires the dependency {{dependency}}.' } },
  create(context) {
    const imports = new Map();
    return {
      ImportDeclaration(node) {
        if (!/\/(features|routes|actions)\//.test(node.source.value)) return;
        const contracts = contractsOf(resolve(dirname(context.filename), node.source.value));
        for (const specifier of node.specifiers)
          if (contracts.has(specifier.imported?.name))
            imports.set(specifier.local.name, contracts.get(specifier.imported.name));
      },
      CallExpression(node) {
        if (!imports.has(node.callee.name)) return;
        const dependencies = node.arguments[0];
        const supplied = new Set(
          dependencies?.type === 'ObjectExpression' ? dependencies.properties.map((property) => property.key?.name) : []
        );
        for (const dependency of imports.get(node.callee.name))
          if (!supplied.has(dependency))
            context.report({ node, messageId: 'missing', data: { factory: node.callee.name, dependency } });
      }
    };
  }
};
