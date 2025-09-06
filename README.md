# KubecmdsViz

A visual interface for executing and visualizing kubectl commands, built with Angular and Express.js.

## Features

- **Interactive Command Templates**: Pre-configured kubectl commands organized by resource type
- **Dynamic Resource Discovery**: Automatically loads namespaces, deployments, and pods
- **Smart Output Parsing**: Visualizes tabular data, YAML, JSON, and events
- **Accordion Sidebar**: Collapsible command categories like database explorers
- **Namespace-aware**: Templates automatically use selected namespace

## Quick Start

### 1. Setup Kubernetes Test Environment

**Optional** - Skip this if you already have kubectl + cluster access

```bash
bash scripts/cluster-setup.sh
```

Creates kind cluster with test services. Perfect for demo/testing.

### 2. Start the Application

```bash
npm run dev
```

This starts both frontend (Angular) and backend (Express) servers. Open `http://localhost:4200` to access the interface.

> For detailed cluster setup instructions, see [cluster-setup-readme.md](./cluster-setup-readme.md)

### 3. Cleanup Environment

```bash
bash scripts/cleanup.sh
```

This will safely remove the test cluster and optionally clean Docker images.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Karma](https://karma-runner.github.io) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
