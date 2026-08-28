# Guided test authoring

Use this when you know the behavior to test but do not know the server's tool, resource, prompt, or response field names.

The `author` command creates a plain-language test by connecting to a live MCP server and asking QA-friendly questions.

```bash
mcprigor author server.mcpr --out tests/search-customer.mcpr
```

`server.mcpr` can be an existing minimal target file:

```text
MCP Test 1
Suite: "QA target"
Server: node dist/server.js
Test: "placeholder"
  Send "ping"
```

## Authoring flow

1. MCP Rigor connects and discovers tools, resources, and prompts.
2. Choose whether to call a tool, read a resource, or get a prompt.
3. Select the operation by its name and description.
4. Enter required inputs derived from the tool JSON Schema or prompt arguments.
5. Review and run the request.
6. Select returned fields to verify.
7. Choose equality, containment, or existence checks.
8. Name the test and review the generated source.
9. Confirm the output file.
10. Run it normally with `mcprigor test`.

Generated files are deterministic:

- `MCP Test 1` language header
- sorted input object keys
- sorted assertions
- two-space indentation
- one trailing newline
- no timestamps or random identifiers

The output is an ordinary `.mcpr` file. It can be edited, reviewed in a pull request, copied, and run without the authoring wizard.

## Input behavior

The wizard understands common JSON Schema input types:

- required and optional object properties
- strings
- numbers and integers
- booleans
- arrays and objects entered as JSON
- property defaults

Unsupported or highly dynamic schemas can still be tested by editing the generated `.mcpr` file afterward. Secret values should be represented through environment variables in the target or generated file; never paste reusable credentials into assertions.

## Response field selection

Responses are flattened into stable paths such as:

```text
$.structuredContent.id
$.content[0].text
$.messages[0].content.text
```

Object keys are sorted and array order is retained. Display previews are capped. Select only stable business fields; prefer `exists` for generated IDs and avoid equality checks on timestamps, tokens, or volatile metadata.

## Automation API

The authoring engine accepts an injected `PromptAdapter`. The included `ScriptedPromptAdapter` lets CI and framework tests run the entire wizard without terminal input. Programmatic APIs are exported from `mcprigor`:

- `authorTest`
- `renderAuthoredTest`
- `flattenResponse`
- `createReadlinePromptAdapter`
- `ScriptedPromptAdapter`

This separation keeps discovery, prompting, execution, rendering, and file writing independently testable.
