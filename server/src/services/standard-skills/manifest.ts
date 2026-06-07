/**
 * Standard skills catalog — the curated starter set for an enterprise
 * e-commerce engineering org (storefront web, iOS, Android, BFF, GraphQL,
 * platform + adjacent design/content/QA/product/security disciplines).
 *
 * Each entry is a delegatable, task-level unit of work an engineer hands off to
 * their local SLAW squad. All v1 entries are `markdown_only` (instructions, no
 * runnable payload). Classified on two axes carried in `metadata`:
 *   layer:      storefront-web | mobile-ios | mobile-android | bff | graphql | platform | cross
 *   discipline: engineering | design | content | qa | devops | product | security | data
 *
 * `category` is set to the layer for backward-compat with the existing
 * single-column filter; `metadata.{layer,discipline}` drive two-axis filtering.
 *
 * See DESIGN-standard-skills-registry.md §6.
 */

export type SkillLayer =
  | "storefront-web"
  | "mobile-ios"
  | "mobile-android"
  | "bff"
  | "graphql"
  | "platform"
  | "cross";

export type SkillDiscipline =
  | "engineering"
  | "design"
  | "content"
  | "qa"
  | "devops"
  | "product"
  | "security"
  | "data";

export interface StandardSkill {
  key: string;
  name: string;
  description: string;
  layer: SkillLayer;
  discipline: SkillDiscipline;
  markdown: string;
}

/** Build the markdown body from a small spec — keeps entries terse + uniform. */
function body(opts: {
  title: string;
  intent: string;
  inputs: string[];
  steps: string[];
  deliverable: string;
  done: string[];
}): string {
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  return `# ${opts.title}

${opts.intent}

## You'll be given
${list(opts.inputs)}

## Approach
${opts.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Deliverable
${opts.deliverable}

## Done when
${list(opts.done)}
`;
}

export const STANDARD_SKILLS: StandardSkill[] = [
  /* ───────────── Storefront — Web ───────────── */
  {
    key: "web-plp-build",
    name: "Web — Product Listing Page",
    description:
      "Build or modify a PLP: grid, filters, sort, pagination, server data fetching, loading/empty states.",
    layer: "storefront-web",
    discipline: "engineering",
    markdown: body({
      title: "Web — Product Listing Page",
      intent: "Implement or change a storefront product listing page end-to-end.",
      inputs: ["Design/spec for the page", "GraphQL queries or data contract", "Filter/sort requirements"],
      steps: [
        "Confirm the data contract (query, variables, pagination shape) before building UI.",
        "Build the grid + product card with loading, empty, and error states.",
        "Wire filters, sort, and pagination to the query; keep state in the URL where it aids sharing/SEO.",
        "Verify responsive behavior and that no layout shift occurs on data load.",
      ],
      deliverable: "A working PLP route with tests for the data wiring and key states.",
      done: ["All states render", "Filters/sort/pagination reflect in the URL", "Tests pass, no CLS regression"],
    }),
  },
  {
    key: "web-pdp-build",
    name: "Web — Product Detail Page",
    description:
      "Build or modify a PDP: gallery, variant selection, price/availability, add-to-cart, structured data.",
    layer: "storefront-web",
    discipline: "engineering",
    markdown: body({
      title: "Web — Product Detail Page",
      intent: "Implement or change a storefront product detail page end-to-end.",
      inputs: ["Design/spec", "Product/variant data contract", "Add-to-cart behavior"],
      steps: [
        "Render gallery, title, price, and availability from the product query.",
        "Implement variant selection that updates price/availability/media reactively.",
        "Wire add-to-cart with optimistic feedback and error handling.",
        "Add product structured data (JSON-LD) and verify it validates.",
      ],
      deliverable: "A working PDP route with variant logic and add-to-cart tested.",
      done: ["Variant changes update all dependent UI", "Add-to-cart works + handles failure", "Structured data valid"],
    }),
  },
  {
    key: "web-cart-checkout",
    name: "Web — Cart & Checkout Flow",
    description:
      "Implement cart and the checkout funnel: line items, promo codes, address/payment steps, error handling.",
    layer: "storefront-web",
    discipline: "engineering",
    markdown: body({
      title: "Web — Cart & Checkout Flow",
      intent: "Build or modify the cart and multi-step checkout funnel.",
      inputs: ["Funnel spec", "Cart/checkout data contract", "Payment provider integration notes"],
      steps: [
        "Implement cart line items, quantity edits, totals, and promo-code application.",
        "Build the checkout steps (contact, address, shipping, payment) with per-step validation.",
        "Handle network and validation errors at each step without losing entered data.",
        "Guard against double-submit and ensure the success/failure states are clear.",
      ],
      deliverable: "Cart + checkout flow with validation and error handling, covered by tests.",
      done: ["Promo codes apply correctly", "Each step validates", "No data loss on error or back-nav"],
    }),
  },
  {
    key: "web-component",
    name: "Web — Reusable Component",
    description: "Build a typed, accessible, themeable component to the design system spec with stories.",
    layer: "storefront-web",
    discipline: "engineering",
    markdown: body({
      title: "Web — Reusable Component",
      intent: "Build a reusable storefront component that conforms to the design system.",
      inputs: ["Component spec/design", "Design tokens", "Prop/API expectations"],
      steps: [
        "Define a typed prop API; provide sensible defaults and avoid required props where possible.",
        "Implement all states (default, hover, focus, disabled, loading, error) using tokens.",
        "Make it accessible: semantics, keyboard, focus management, ARIA where needed.",
        "Add stories/examples and unit tests for the prop variations.",
      ],
      deliverable: "A component with typed API, full states, a11y, stories, and tests.",
      done: ["Matches design + tokens", "Keyboard + screen-reader usable", "Stories + tests cover variants"],
    }),
  },
  {
    key: "web-state-data",
    name: "Web — State & Data Fetching",
    description: "Wire client/server state, caching, optimistic updates, and the GraphQL queries a page needs.",
    layer: "storefront-web",
    discipline: "engineering",
    markdown: body({
      title: "Web — State & Data Fetching",
      intent: "Set up or refactor the data/state layer for a feature or page.",
      inputs: ["The page's data needs", "GraphQL schema", "Caching/invalidation expectations"],
      steps: [
        "Map what is server state vs client/UI state; don't conflate them.",
        "Write the queries/mutations with correct cache keys and pagination.",
        "Add optimistic updates where they improve perceived speed; ensure rollback on failure.",
        "Define invalidation so stale data doesn't linger after mutations.",
      ],
      deliverable: "A clean data layer with queries, cache config, and optimistic flows tested.",
      done: ["No over-fetching/N+1 from the client", "Optimistic updates roll back on error", "Cache invalidates correctly"],
    }),
  },
  {
    key: "web-perf",
    name: "Web — Performance / Core Web Vitals",
    description: "Diagnose and fix LCP/CLS/INP, bundle size, image and font loading on a given route.",
    layer: "storefront-web",
    discipline: "engineering",
    markdown: body({
      title: "Web — Performance / Core Web Vitals",
      intent: "Improve measured performance of a specific route.",
      inputs: ["The target route", "Current CWV / Lighthouse numbers", "Any perf budget"],
      steps: [
        "Measure first — capture LCP, CLS, INP, and bundle size before changing anything.",
        "Attack the largest contributor: image/font loading, render-blocking JS, hydration cost.",
        "Reduce bundle via code-splitting/lazy-loading; reserve space to eliminate CLS.",
        "Re-measure and confirm each change moved the metric it targeted.",
      ],
      deliverable: "Measurable CWV improvement with before/after numbers documented.",
      done: ["Each metric measured before + after", "Targets hit or budget met", "No functional regressions"],
    }),
  },
  {
    key: "web-seo",
    name: "Web — Technical SEO",
    description: "Metadata, canonical/hreflang, sitemaps, structured data, crawlability for storefront pages.",
    layer: "storefront-web",
    discipline: "engineering",
    markdown: body({
      title: "Web — Technical SEO",
      intent: "Improve technical SEO for storefront pages.",
      inputs: ["Target pages/templates", "Locale/canonical rules", "Structured-data requirements"],
      steps: [
        "Audit titles, meta descriptions, canonical, and hreflang for the target templates.",
        "Ensure server-rendered content is crawlable and not gated behind client-only rendering.",
        "Add/verify structured data (Product, BreadcrumbList, etc.) and validate it.",
        "Check sitemap inclusion and robots directives.",
      ],
      deliverable: "SEO fixes across the target templates with validation evidence.",
      done: ["Canonical/hreflang correct", "Structured data validates", "Content crawlable server-side"],
    }),
  },
  {
    key: "web-a11y",
    name: "Web — Accessibility (WCAG)",
    description: "Audit and fix a page/component to WCAG AA: semantics, focus, ARIA, contrast, keyboard nav.",
    layer: "storefront-web",
    discipline: "qa",
    markdown: body({
      title: "Web — Accessibility (WCAG AA)",
      intent: "Bring a page or component up to WCAG 2.1 AA.",
      inputs: ["The target page/component", "Known issues, if any"],
      steps: [
        "Run an automated pass (axe) and capture violations, then verify manually.",
        "Fix semantics and structure first (headings, landmarks, labels).",
        "Ensure full keyboard operability and visible focus; manage focus on dynamic UI.",
        "Check color contrast and that information isn't conveyed by color alone.",
      ],
      deliverable: "An accessible page/component with the audit findings resolved.",
      done: ["No critical axe violations", "Fully keyboard operable", "Contrast meets AA"],
    }),
  },

  /* ───────────── Mobile — iOS ───────────── */
  {
    key: "ios-feature-dev",
    name: "iOS — Feature Development",
    description: "Implement a feature end-to-end: screens, navigation, networking, state, persistence.",
    layer: "mobile-ios",
    discipline: "engineering",
    markdown: body({
      title: "iOS — Feature Development",
      intent: "Build an iOS feature end-to-end.",
      inputs: ["Feature spec/design", "API/GraphQL contract", "Navigation/entry points"],
      steps: [
        "Model the feature's state and data flow before writing UI.",
        "Build screens + navigation; wire networking and persistence.",
        "Handle loading/empty/error states and offline behavior.",
        "Add unit tests for the logic and a UI test for the primary path.",
      ],
      deliverable: "A working iOS feature with tests for logic and the happy path.",
      done: ["Feature works on device/simulator", "States handled", "Tests pass"],
    }),
  },
  {
    key: "ios-swiftui-ui",
    name: "iOS — SwiftUI UI Build",
    description: "Build a screen/component in SwiftUI to the design spec: layout, theming, dynamic type, dark mode.",
    layer: "mobile-ios",
    discipline: "engineering",
    markdown: body({
      title: "iOS — SwiftUI UI Build",
      intent: "Build a SwiftUI screen or component matching the design.",
      inputs: ["Design/spec", "Design tokens/theme", "Accessibility expectations"],
      steps: [
        "Compose the view from small, reusable subviews; keep state minimal and local.",
        "Apply theme tokens; support light/dark mode and Dynamic Type.",
        "Handle all visual states and verify on multiple device sizes.",
        "Add accessibility labels/traits and a preview for each state.",
      ],
      deliverable: "A SwiftUI view matching design with theming + a11y, plus previews.",
      done: ["Matches design across sizes", "Dark mode + Dynamic Type work", "A11y labels present"],
    }),
  },
  {
    key: "ios-networking",
    name: "iOS — Networking & GraphQL Client",
    description: "Wire the Apollo/GraphQL client, models, caching, auth, and error/retry for a feature.",
    layer: "mobile-ios",
    discipline: "engineering",
    markdown: body({
      title: "iOS — Networking & GraphQL Client",
      intent: "Set up the networking layer for an iOS feature.",
      inputs: ["GraphQL schema/operations", "Auth scheme", "Caching expectations"],
      steps: [
        "Define operations and generate/typed models.",
        "Wire auth (token attach/refresh) and a consistent error mapping.",
        "Configure caching and define when to read from cache vs network.",
        "Add retry/backoff for transient failures and tests for the mapping.",
      ],
      deliverable: "A networking layer with typed operations, auth, caching, and error handling.",
      done: ["Operations typed", "Auth + refresh work", "Errors mapped + tested"],
    }),
  },
  {
    key: "ios-release-ci",
    name: "iOS — Release & CI (Fastlane)",
    description: "Set up or maintain build, signing, TestFlight, and App Store submission via CI.",
    layer: "mobile-ios",
    discipline: "devops",
    markdown: body({
      title: "iOS — Release & CI",
      intent: "Build or maintain the iOS release pipeline.",
      inputs: ["Signing assets/match config", "Target tracks (TestFlight/App Store)", "CI environment"],
      steps: [
        "Automate build + signing reproducibly in CI.",
        "Wire TestFlight upload and, where applicable, App Store submission.",
        "Manage versioning/build numbers and changelog.",
        "Document the release steps and failure recovery.",
      ],
      deliverable: "A working CI release pipeline with documented steps.",
      done: ["CI builds + signs reliably", "Upload to track works", "Release steps documented"],
    }),
  },
  {
    key: "ios-test",
    name: "iOS — Unit & UI Tests",
    description: "Write XCTest unit + UI tests covering the feature's happy path, edges, and a regression.",
    layer: "mobile-ios",
    discipline: "qa",
    markdown: body({
      title: "iOS — Unit & UI Tests",
      intent: "Add meaningful test coverage for an iOS feature.",
      inputs: ["The feature/code under test", "Known risk areas"],
      steps: [
        "Unit-test the logic: happy path, edges, and the failure the change addresses.",
        "Add a UI test for the primary user path.",
        "Keep tests deterministic; stub network and time where needed.",
        "Verify they fail when the behavior breaks.",
      ],
      deliverable: "XCTest coverage that meaningfully guards the feature.",
      done: ["Logic + primary path covered", "Deterministic", "Tests catch regressions"],
    }),
  },

  /* ───────────── Mobile — Android ───────────── */
  {
    key: "android-feature-dev",
    name: "Android — Feature Development",
    description: "Implement a feature end-to-end: screens, navigation, networking, state, persistence.",
    layer: "mobile-android",
    discipline: "engineering",
    markdown: body({
      title: "Android — Feature Development",
      intent: "Build an Android feature end-to-end.",
      inputs: ["Feature spec/design", "API/GraphQL contract", "Navigation/entry points"],
      steps: [
        "Model state and data flow; choose the right scope for each piece of state.",
        "Build screens + navigation; wire networking and persistence.",
        "Handle loading/empty/error and process-death restoration.",
        "Add unit tests for logic and a UI test for the primary path.",
      ],
      deliverable: "A working Android feature with tests for logic and the happy path.",
      done: ["Feature works on device/emulator", "States + restoration handled", "Tests pass"],
    }),
  },
  {
    key: "android-compose-ui",
    name: "Android — Jetpack Compose UI",
    description: "Build a screen/component in Compose to spec: layout, theming, Material 3, dark mode.",
    layer: "mobile-android",
    discipline: "engineering",
    markdown: body({
      title: "Android — Jetpack Compose UI",
      intent: "Build a Compose screen or component matching the design.",
      inputs: ["Design/spec", "Theme/Material 3 tokens", "Accessibility expectations"],
      steps: [
        "Compose from small stateless composables; hoist state appropriately.",
        "Apply Material 3 theming; support dark mode and font scaling.",
        "Handle all visual states; preview each.",
        "Add content descriptions and verify with TalkBack expectations.",
      ],
      deliverable: "A Compose UI matching design with theming + a11y and previews.",
      done: ["Matches design", "Dark mode + font scaling work", "A11y descriptions present"],
    }),
  },
  {
    key: "android-networking",
    name: "Android — Networking & GraphQL Client",
    description: "Wire the Apollo/GraphQL client, models, caching, auth, and error/retry for a feature.",
    layer: "mobile-android",
    discipline: "engineering",
    markdown: body({
      title: "Android — Networking & GraphQL Client",
      intent: "Set up the networking layer for an Android feature.",
      inputs: ["GraphQL schema/operations", "Auth scheme", "Caching expectations"],
      steps: [
        "Define typed operations and models.",
        "Wire auth (attach/refresh) and consistent error mapping.",
        "Configure caching and cache-vs-network policy.",
        "Add retry/backoff and tests for the error mapping.",
      ],
      deliverable: "A networking layer with typed operations, auth, caching, error handling.",
      done: ["Operations typed", "Auth + refresh work", "Errors mapped + tested"],
    }),
  },
  {
    key: "android-release-ci",
    name: "Android — Release & CI (Play)",
    description: "Set up or maintain build, signing, internal track, and Play Store release via CI.",
    layer: "mobile-android",
    discipline: "devops",
    markdown: body({
      title: "Android — Release & CI",
      intent: "Build or maintain the Android release pipeline.",
      inputs: ["Signing keystore/config", "Target tracks", "CI environment"],
      steps: [
        "Automate build + signing reproducibly in CI.",
        "Wire upload to the internal/closed track and promotion flow.",
        "Manage versionCode/versionName and release notes.",
        "Document release + rollback steps.",
      ],
      deliverable: "A working CI release pipeline with documented steps.",
      done: ["CI builds + signs reliably", "Track upload works", "Steps documented"],
    }),
  },
  {
    key: "android-test",
    name: "Android — Unit & UI Tests",
    description: "Write JUnit/Espresso/Compose tests covering happy path, edges, and a regression.",
    layer: "mobile-android",
    discipline: "qa",
    markdown: body({
      title: "Android — Unit & UI Tests",
      intent: "Add meaningful test coverage for an Android feature.",
      inputs: ["The feature/code under test", "Known risk areas"],
      steps: [
        "Unit-test logic: happy path, edges, the failure addressed.",
        "Add an Espresso/Compose UI test for the primary path.",
        "Keep tests deterministic; use fakes for network/time.",
        "Confirm they fail when behavior breaks.",
      ],
      deliverable: "JUnit + UI coverage that guards the feature.",
      done: ["Logic + primary path covered", "Deterministic", "Catch regressions"],
    }),
  },

  /* ───────────── BFF ───────────── */
  {
    key: "bff-endpoint",
    name: "BFF — Endpoint / Aggregator",
    description: "Build a BFF endpoint that aggregates downstream services for a specific client view.",
    layer: "bff",
    discipline: "engineering",
    markdown: body({
      title: "BFF — Endpoint / Aggregator",
      intent: "Build a BFF endpoint shaped for a specific client view.",
      inputs: ["The client view's data needs", "Downstream service contracts", "Auth context"],
      steps: [
        "Define the response shape the client actually needs — no over- or under-fetching.",
        "Aggregate downstream calls; parallelize independent ones.",
        "Map downstream errors to clear client-facing responses.",
        "Add tests for the aggregation and error mapping.",
      ],
      deliverable: "A BFF endpoint tailored to the client view with tests.",
      done: ["Response shape fits the client", "Independent calls parallelized", "Errors mapped + tested"],
    }),
  },
  {
    key: "bff-auth-session",
    name: "BFF — Auth & Session",
    description: "Implement auth, token exchange, and session handling at the BFF boundary.",
    layer: "bff",
    discipline: "engineering",
    markdown: body({
      title: "BFF — Auth & Session",
      intent: "Implement authentication and session handling at the BFF.",
      inputs: ["Auth scheme (OAuth/OIDC/etc.)", "Session/cookie requirements", "Downstream token needs"],
      steps: [
        "Implement login/token exchange and secure session storage.",
        "Handle token refresh and expiry transparently to the client.",
        "Propagate identity to downstream calls correctly.",
        "Cover the auth edge cases (expiry, revocation) with tests.",
      ],
      deliverable: "Auth + session handling at the BFF with tests for edge cases.",
      done: ["Login + refresh work", "Sessions secure", "Edge cases tested"],
    }),
  },
  {
    key: "bff-caching-resilience",
    name: "BFF — Caching & Resilience",
    description: "Add caching, timeouts, retries, circuit-breaking, and graceful degradation to a BFF route.",
    layer: "bff",
    discipline: "engineering",
    markdown: body({
      title: "BFF — Caching & Resilience",
      intent: "Make a BFF route fast and resilient to downstream failure.",
      inputs: ["The route + its downstreams", "Latency/availability targets", "Acceptable staleness"],
      steps: [
        "Add caching with sensible TTLs where staleness is acceptable.",
        "Set timeouts and retries/backoff for downstream calls.",
        "Add circuit-breaking and a graceful-degradation path (partial/cached response).",
        "Test the degraded paths, not just the happy path.",
      ],
      deliverable: "A resilient BFF route with caching and tested degradation.",
      done: ["Caching correct", "Timeouts/retries set", "Degraded paths tested"],
    }),
  },
  {
    key: "bff-contract-test",
    name: "BFF — Contract Tests",
    description: "Write contract/integration tests for a BFF endpoint against its downstream dependencies.",
    layer: "bff",
    discipline: "qa",
    markdown: body({
      title: "BFF — Contract Tests",
      intent: "Guard a BFF endpoint's contract with downstreams.",
      inputs: ["The endpoint", "Downstream contracts", "Existing fixtures, if any"],
      steps: [
        "Define the consumer/provider contract explicitly.",
        "Write tests that fail when a downstream shape changes.",
        "Cover error and partial-response scenarios.",
        "Wire the tests into CI.",
      ],
      deliverable: "Contract/integration tests that catch downstream drift.",
      done: ["Contract encoded in tests", "Error scenarios covered", "Runs in CI"],
    }),
  },

  /* ───────────── GraphQL ───────────── */
  {
    key: "gql-schema-design",
    name: "GraphQL — Schema Design",
    description: "Design or extend types, fields, and relationships for a domain; naming, nullability, pagination.",
    layer: "graphql",
    discipline: "engineering",
    markdown: body({
      title: "GraphQL — Schema Design",
      intent: "Design or extend the GraphQL schema for a domain.",
      inputs: ["The domain/feature", "Existing schema conventions", "Client query needs"],
      steps: [
        "Model types and relationships around client needs, not table structure.",
        "Choose nullability deliberately; default to non-null only when truly guaranteed.",
        "Use connection-style pagination for lists; follow naming conventions.",
        "Plan deprecation for any field you're replacing.",
      ],
      deliverable: "A schema change with clear types, nullability, and pagination.",
      done: ["Types fit client needs", "Nullability deliberate", "Conventions + pagination followed"],
    }),
  },
  {
    key: "gql-resolver",
    name: "GraphQL — Resolver Implementation",
    description: "Implement resolvers with dataloaders, N+1 avoidance, auth, and error mapping.",
    layer: "graphql",
    discipline: "engineering",
    markdown: body({
      title: "GraphQL — Resolver Implementation",
      intent: "Implement resolvers for a schema change.",
      inputs: ["The schema fields", "Data sources", "Auth rules"],
      steps: [
        "Implement resolvers; batch with dataloaders to avoid N+1.",
        "Enforce field/type-level authorization.",
        "Map errors to the schema's error model consistently.",
        "Add tests including the N+1 guard.",
      ],
      deliverable: "Resolvers with batching, auth, and error handling, tested.",
      done: ["No N+1", "Auth enforced", "Errors mapped + tested"],
    }),
  },
  {
    key: "gql-federation",
    name: "GraphQL — Federation / Gateway",
    description: "Compose or extend a federated subgraph and wire it into the gateway.",
    layer: "graphql",
    discipline: "engineering",
    markdown: body({
      title: "GraphQL — Federation / Gateway",
      intent: "Add or extend a federated subgraph.",
      inputs: ["Subgraph boundaries", "Entity keys/references", "Gateway composition setup"],
      steps: [
        "Define entity keys and references for cross-subgraph resolution.",
        "Implement reference resolvers correctly.",
        "Verify the supergraph composes without conflicts.",
        "Test cross-subgraph queries end-to-end.",
      ],
      deliverable: "A composed subgraph wired into the gateway with tests.",
      done: ["Supergraph composes", "Entities resolve across subgraphs", "Cross-subgraph queries tested"],
    }),
  },
  {
    key: "gql-breaking-change",
    name: "GraphQL — Schema Change Review",
    description: "Review a schema change for breaking impact, deprecation path, and client compatibility.",
    layer: "graphql",
    discipline: "qa",
    markdown: body({
      title: "GraphQL — Schema Change Review",
      intent: "Assess whether a schema change is safe for clients.",
      inputs: ["The proposed schema diff", "Known client operations", "Deprecation policy"],
      steps: [
        "Run schema diff/linting to surface breaking changes.",
        "Check the change against real client operations.",
        "Require a deprecation path for anything removed/renamed.",
        "Document migration guidance for clients.",
      ],
      deliverable: "A review verdict with breaking-change findings and a migration path.",
      done: ["Breaking changes identified", "Deprecation path defined", "Client guidance documented"],
    }),
  },

  /* ───────────── Platform ───────────── */
  {
    key: "platform-cicd",
    name: "Platform — CI/CD Pipeline",
    description: "Build or modify a CI/CD pipeline: build, test, gates, deploy stages, rollback.",
    layer: "platform",
    discipline: "devops",
    markdown: body({
      title: "Platform — CI/CD Pipeline",
      intent: "Build or change a service's CI/CD pipeline.",
      inputs: ["The service + environments", "Test/quality gates", "Deploy + rollback strategy"],
      steps: [
        "Define build → test → gate → deploy stages.",
        "Make builds reproducible and fast (caching, parallelism).",
        "Add deploy gates and an automated rollback path.",
        "Document how to operate and recover the pipeline.",
      ],
      deliverable: "A working pipeline with gates and rollback, documented.",
      done: ["Stages run reliably", "Gates enforced", "Rollback works + documented"],
    }),
  },
  {
    key: "platform-iac",
    name: "Platform — Infrastructure as Code",
    description: "Author or modify IaC (Terraform/etc.) for a service: networking, scaling, secrets.",
    layer: "platform",
    discipline: "devops",
    markdown: body({
      title: "Platform — Infrastructure as Code",
      intent: "Provision or change infrastructure via IaC.",
      inputs: ["The service's infra needs", "Existing IaC conventions", "Secrets/identity approach"],
      steps: [
        "Express the change as code; keep it modular and reviewable.",
        "Handle networking, scaling, and secrets without hardcoding.",
        "Plan and review the diff before applying.",
        "Document the resources and how to roll back.",
      ],
      deliverable: "Reviewed IaC for the change with a clean plan.",
      done: ["Plan is clean + reviewed", "No hardcoded secrets", "Rollback documented"],
    }),
  },
  {
    key: "platform-observability",
    name: "Platform — Observability",
    description: "Add logging, metrics, tracing, dashboards, and alerts for a service or flow.",
    layer: "platform",
    discipline: "devops",
    markdown: body({
      title: "Platform — Observability",
      intent: "Make a service or flow observable.",
      inputs: ["The service/flow", "Key SLIs", "Alerting destinations"],
      steps: [
        "Add structured logs, metrics, and traces at the right boundaries.",
        "Build a dashboard for the key SLIs.",
        "Define actionable alerts (symptom-based, not noisy).",
        "Verify signals appear under real and failure conditions.",
      ],
      deliverable: "Logging/metrics/tracing + a dashboard and alerts.",
      done: ["SLIs visible", "Alerts actionable, low-noise", "Signals verified"],
    }),
  },
  {
    key: "platform-incident",
    name: "Platform — Incident Runbook",
    description: "Triage an alert: assess scope, mitigate, communicate status, then capture a post-incident note.",
    layer: "platform",
    discipline: "devops",
    markdown: body({
      title: "Platform — Incident Runbook",
      intent: "Drive an incident from alert to resolution and learning.",
      inputs: ["The alert/symptoms", "Recent changes", "Comms channels"],
      steps: [
        "Assess scope and impact; declare severity.",
        "Mitigate first (rollback/feature-flag) before root-causing.",
        "Communicate status at a steady cadence.",
        "After resolution, capture a blameless post-incident note with follow-ups.",
      ],
      deliverable: "A mitigated incident and a post-incident note with action items.",
      done: ["Impact mitigated", "Status communicated", "Post-incident note + follow-ups recorded"],
    }),
  },

  /* ───────────── Design (cross) ───────────── */
  {
    key: "ux-flow-design",
    name: "UX — Flow & Interaction Design",
    description: "Design a user flow: states, edge cases, error/empty/loading, and the interaction model.",
    layer: "cross",
    discipline: "design",
    markdown: body({
      title: "UX — Flow & Interaction Design",
      intent: "Design the end-to-end flow for a feature.",
      inputs: ["The user goal", "Entry points + constraints", "Existing patterns"],
      steps: [
        "Map the happy path, then enumerate edge cases and failure states.",
        "Design empty/loading/error states explicitly, not as afterthoughts.",
        "Define the interaction model and transitions.",
        "Note acceptance criteria a developer can build and test against.",
      ],
      deliverable: "A flow spec covering all states with acceptance criteria.",
      done: ["All states designed", "Edge cases covered", "Acceptance criteria clear"],
    }),
  },
  {
    key: "ux-wireframe",
    name: "UX — Wireframe / Spec",
    description: "Produce a wireframe + annotated spec a dev can build from, with acceptance criteria.",
    layer: "cross",
    discipline: "design",
    markdown: body({
      title: "UX — Wireframe / Spec",
      intent: "Produce a buildable wireframe and spec.",
      inputs: ["The feature/flow", "Content + data available", "Platform constraints"],
      steps: [
        "Wireframe the layout and hierarchy for each screen/state.",
        "Annotate behavior, content rules, and responsive/adaptive notes.",
        "Specify acceptance criteria and edge cases.",
        "Flag open questions for product/eng.",
      ],
      deliverable: "An annotated wireframe + spec with acceptance criteria.",
      done: ["Layouts + states wireframed", "Behavior annotated", "Acceptance criteria included"],
    }),
  },
  {
    key: "ui-design-system",
    name: "UI — Design System Contribution",
    description: "Define or extend a design-system token or component: spec, states, a11y, usage rules.",
    layer: "cross",
    discipline: "design",
    markdown: body({
      title: "UI — Design System Contribution",
      intent: "Add or change a design-system token or component.",
      inputs: ["The need + gap in the system", "Existing tokens/components", "A11y standards"],
      steps: [
        "Justify the addition vs reusing/extending an existing element.",
        "Specify all states, tokens, and responsive behavior.",
        "Define a11y requirements and usage do's/don'ts.",
        "Provide examples and migration notes if it replaces something.",
      ],
      deliverable: "A design-system spec with states, a11y, and usage guidance.",
      done: ["Justified + consistent", "States + tokens specified", "A11y + usage documented"],
    }),
  },
  {
    key: "ux-research-synthesis",
    name: "UX — Research Synthesis",
    description: "Turn research notes/feedback into findings, opportunities, and prioritized recommendations.",
    layer: "cross",
    discipline: "design",
    markdown: body({
      title: "UX — Research Synthesis",
      intent: "Synthesize research into actionable findings.",
      inputs: ["Raw notes/transcripts/feedback", "The research questions", "Decisions it should inform"],
      steps: [
        "Cluster observations into themes; separate observation from interpretation.",
        "Derive findings with supporting evidence.",
        "Translate findings into opportunities and prioritized recommendations.",
        "State confidence and gaps honestly.",
      ],
      deliverable: "A synthesis with findings, opportunities, and ranked recommendations.",
      done: ["Themes evidence-backed", "Recommendations prioritized", "Confidence + gaps stated"],
    }),
  },

  /* ───────────── Content (cross) ───────────── */
  {
    key: "copywriting-ui",
    name: "Copywriting — UI / Microcopy",
    description: "Write product UI copy: buttons, empty states, errors, onboarding — clear, on-brand, concise.",
    layer: "cross",
    discipline: "content",
    markdown: body({
      title: "Copywriting — UI / Microcopy",
      intent: "Write or improve in-product UI copy.",
      inputs: ["The screens/states needing copy", "Voice + tone guidelines", "Constraints (length, i18n)"],
      steps: [
        "Write for the user's goal at that moment; lead with the benefit/action.",
        "Keep it concise and scannable; match voice and tone.",
        "Write helpful, specific error and empty-state copy.",
        "Check length limits and localization-friendliness.",
      ],
      deliverable: "UI copy for the target states, ready to implement.",
      done: ["Clear + concise", "On brand", "Errors/empty states helpful + i18n-safe"],
    }),
  },
  {
    key: "copywriting-marketing",
    name: "Copywriting — Marketing / Launch",
    description: "Write campaign/launch copy: PDP marketing blocks, emails, landing hero — persuasive, on-brand.",
    layer: "cross",
    discipline: "content",
    markdown: body({
      title: "Copywriting — Marketing / Launch",
      intent: "Write persuasive marketing/launch copy.",
      inputs: ["The offer/product + audience", "Brand voice", "Channel + format"],
      steps: [
        "Lead with the value proposition for the specific audience.",
        "Match the channel's format and length; one clear CTA.",
        "Keep claims accurate and on-brand.",
        "Offer a couple of variations for testing where useful.",
      ],
      deliverable: "Channel-ready marketing copy with a clear CTA.",
      done: ["Value prop clear", "On brand + accurate", "Fits the channel"],
    }),
  },
  {
    key: "content-seo",
    name: "Content — SEO Writing",
    description: "Write category/guide content optimized for target queries without keyword stuffing.",
    layer: "cross",
    discipline: "content",
    markdown: body({
      title: "Content — SEO Writing",
      intent: "Write SEO content that serves the reader and the query.",
      inputs: ["Target query/intent", "Audience", "Brand voice + any factual sources"],
      steps: [
        "Match the search intent; structure with clear headings.",
        "Use keywords naturally — no stuffing.",
        "Be genuinely useful and accurate; cite sources where claims need them.",
        "Add appropriate metadata/title suggestions.",
      ],
      deliverable: "SEO content matching intent, with title/meta suggestions.",
      done: ["Matches intent", "Reads naturally", "Accurate + well-structured"],
    }),
  },
  {
    key: "content-localization",
    name: "Content — Localization Brief",
    description: "Prepare strings + context for localization; flag idioms, length, and formatting constraints.",
    layer: "cross",
    discipline: "content",
    markdown: body({
      title: "Content — Localization Brief",
      intent: "Prepare content for high-quality localization.",
      inputs: ["The strings/content", "Target locales", "UI constraints"],
      steps: [
        "Provide context for each string (where it appears, what it means).",
        "Flag idioms, humor, and culture-specific references.",
        "Note length limits and formatting/placeholder rules.",
        "Call out date/number/currency formatting needs.",
      ],
      deliverable: "A localization brief that lets translators work without guessing.",
      done: ["Each string has context", "Idioms/constraints flagged", "Formatting rules noted"],
    }),
  },

  /* ───────────── Quality (cross) ───────────── */
  {
    key: "qa-e2e",
    name: "QA — End-to-End Test Suite",
    description: "Design or extend an e2e suite for a user journey (browse → cart → checkout) with stable selectors.",
    layer: "cross",
    discipline: "qa",
    markdown: body({
      title: "QA — End-to-End Test Suite",
      intent: "Build e2e coverage for a critical user journey.",
      inputs: ["The journey", "Test environment/data", "Existing framework"],
      steps: [
        "Script the journey with stable, semantic selectors (not brittle CSS).",
        "Make tests independent and idempotent with seeded data.",
        "Cover the key failure branches, not only the happy path.",
        "Wire into CI with sensible retries for flake, not for masking bugs.",
      ],
      deliverable: "An e2e suite covering the journey, running in CI.",
      done: ["Journey covered", "Selectors stable", "Runs reliably in CI"],
    }),
  },
  {
    key: "qa-test-plan",
    name: "QA — Test Plan / Strategy",
    description: "Write a test plan for a feature: scope, risk areas, cases, data, and exit criteria.",
    layer: "cross",
    discipline: "qa",
    markdown: body({
      title: "QA — Test Plan / Strategy",
      intent: "Plan how a feature will be tested.",
      inputs: ["The feature spec", "Risk areas", "Available environments/data"],
      steps: [
        "Identify scope and the highest-risk areas to focus effort.",
        "Enumerate cases across the test pyramid (unit/integration/e2e/manual).",
        "Specify test data and environment needs.",
        "Define clear exit criteria.",
      ],
      deliverable: "A test plan with prioritized cases and exit criteria.",
      done: ["Risks prioritized", "Cases mapped to levels", "Exit criteria defined"],
    }),
  },
  {
    key: "qa-perf-testing",
    name: "QA — Performance / Load Testing",
    description: "Define and interpret a load/perf test for a flow; identify thresholds and regressions.",
    layer: "cross",
    discipline: "qa",
    markdown: body({
      title: "QA — Performance / Load Testing",
      intent: "Load/perf-test a flow and interpret the results.",
      inputs: ["The flow/endpoint", "Expected load profile", "Latency/throughput targets"],
      steps: [
        "Model a realistic load profile.",
        "Run the test and capture latency percentiles, throughput, and errors.",
        "Compare against targets and prior baselines.",
        "Identify bottlenecks and regressions with evidence.",
      ],
      deliverable: "Perf results vs targets with bottlenecks identified.",
      done: ["Realistic profile", "Percentiles captured", "Bottlenecks/regressions identified"],
    }),
  },

  /* ───────────── Code & change (cross engineering) ───────────── */
  {
    key: "code-review",
    name: "Code Review",
    description: "Review a diff for correctness, security, and clarity; cite file:line, prioritize by severity, suggest concrete fixes.",
    layer: "cross",
    discipline: "engineering",
    markdown: body({
      title: "Code Review",
      intent: "Review a change for correctness, security, and clarity.",
      inputs: ["The diff/PR", "Context on intent", "Relevant standards"],
      steps: [
        "Understand the intent before judging the code.",
        "Check correctness, edge cases, security, and tests.",
        "Cite file:line; prioritize findings by severity.",
        "Suggest concrete fixes, and distinguish blocking from nits.",
      ],
      deliverable: "A prioritized review with concrete, actionable comments.",
      done: ["Severity prioritized", "Findings cite file:line", "Fixes concrete"],
    }),
  },
  {
    key: "pr-description",
    name: "PR Description",
    description: "Summarize a change set: what, why, how to test, risk.",
    layer: "cross",
    discipline: "engineering",
    markdown: body({
      title: "PR Description",
      intent: "Write a clear PR description from a change set.",
      inputs: ["The diff", "The motivating issue/ticket"],
      steps: [
        "State what changed and why, concisely.",
        "Give reviewers a how-to-test section.",
        "Call out risk, rollout, and any follow-ups.",
        "Link the issue and any related context.",
      ],
      deliverable: "A PR description: what, why, how to test, risk.",
      done: ["What + why clear", "Test steps included", "Risk + links noted"],
    }),
  },
  {
    key: "debugging",
    name: "Systematic Debugging",
    description: "Reproduce, isolate, hypothesize, and verify a fix; change one thing at a time and confirm with a test.",
    layer: "cross",
    discipline: "engineering",
    markdown: body({
      title: "Systematic Debugging",
      intent: "Find and fix a bug methodically.",
      inputs: ["The bug report/symptoms", "Repro steps, if any", "Relevant code"],
      steps: [
        "Reproduce reliably first; if you can't, gather more signal.",
        "Isolate by bisecting/narrowing; form a hypothesis.",
        "Change one thing at a time and observe.",
        "Confirm the fix with a test that fails before and passes after.",
      ],
      deliverable: "A verified fix with a regression test.",
      done: ["Reproduced", "Root cause identified", "Regression test added"],
    }),
  },
  {
    key: "spec-writing",
    name: "Spec / Design Doc",
    description: "Write a design doc: summary, goals/non-goals, decisions, interfaces, rollout, deferred work.",
    layer: "cross",
    discipline: "engineering",
    markdown: body({
      title: "Spec / Design Doc",
      intent: "Write a design doc for a non-trivial change.",
      inputs: ["The problem + context", "Constraints", "Stakeholders"],
      steps: [
        "Open with a one-paragraph summary and goals/non-goals.",
        "Lay out the decisions and the schema/interfaces they touch.",
        "Cover rollout, risks, and what's deferred.",
        "List open questions for review.",
      ],
      deliverable: "A reviewable design doc with decisions and rollout.",
      done: ["Goals/non-goals stated", "Decisions + interfaces clear", "Rollout + deferred work covered"],
    }),
  },
  {
    key: "tech-debt-refactor",
    name: "Refactor / Tech-Debt",
    description: "Refactor a module behind tests with no behavior change; document the before/after.",
    layer: "cross",
    discipline: "engineering",
    markdown: body({
      title: "Refactor / Tech-Debt",
      intent: "Refactor safely without changing behavior.",
      inputs: ["The module + the smell/debt", "Existing tests", "Constraints"],
      steps: [
        "Ensure characterization tests exist before changing anything.",
        "Refactor in small, reversible steps; keep tests green throughout.",
        "Avoid scope creep — behavior must not change.",
        "Document the before/after and any follow-ups.",
      ],
      deliverable: "A refactor with no behavior change, tests green, documented.",
      done: ["Tests green throughout", "No behavior change", "Before/after documented"],
    }),
  },
  {
    key: "dependency-upgrade",
    name: "Dependency Upgrade",
    description: "Upgrade a dependency/framework: changelog review, codemods, test pass, rollout note.",
    layer: "cross",
    discipline: "engineering",
    markdown: body({
      title: "Dependency Upgrade",
      intent: "Upgrade a dependency safely.",
      inputs: ["The dependency + target version", "Changelog/migration guide", "Test suite"],
      steps: [
        "Read the changelog for breaking changes; plan the migration.",
        "Apply codemods/migrations; update call sites.",
        "Run the full test suite and fix fallout.",
        "Write a rollout note covering risk and how to roll back.",
      ],
      deliverable: "A completed upgrade with green tests and a rollout note.",
      done: ["Breaking changes handled", "Tests green", "Rollout/rollback documented"],
    }),
  },

  /* ───────────── Product (cross) ───────────── */
  {
    key: "product-prd",
    name: "Product — PRD / Feature Brief",
    description: "Write a PRD: problem, users, scope, success metrics, acceptance criteria, open questions.",
    layer: "cross",
    discipline: "product",
    markdown: body({
      title: "Product — PRD / Feature Brief",
      intent: "Write a PRD that aligns the team on what and why.",
      inputs: ["The problem + evidence", "Target users", "Constraints + timeline"],
      steps: [
        "State the problem and who has it, with evidence.",
        "Define scope, explicitly listing non-goals.",
        "Set success metrics and acceptance criteria.",
        "List risks and open questions.",
      ],
      deliverable: "A PRD with problem, scope, metrics, and acceptance criteria.",
      done: ["Problem evidence-backed", "Scope + non-goals clear", "Metrics + acceptance criteria set"],
    }),
  },
  {
    key: "product-experiment",
    name: "Product — Experiment Design",
    description: "Design an A/B test: hypothesis, variants, metrics, sample size, guardrails.",
    layer: "cross",
    discipline: "product",
    markdown: body({
      title: "Product — Experiment Design",
      intent: "Design a sound A/B experiment.",
      inputs: ["The hypothesis", "Primary metric", "Traffic/baseline rates"],
      steps: [
        "State a falsifiable hypothesis and the primary metric.",
        "Define variants and randomization unit.",
        "Compute required sample size / duration for power.",
        "Set guardrail metrics and a stopping rule.",
      ],
      deliverable: "An experiment design with sizing and guardrails.",
      done: ["Hypothesis + metric clear", "Sized for power", "Guardrails + stopping rule defined"],
    }),
  },
  {
    key: "product-analytics",
    name: "Product — Funnel / Event Analysis",
    description: "Define tracking events for a flow and analyze the funnel for drop-off and opportunities.",
    layer: "cross",
    discipline: "data",
    markdown: body({
      title: "Product — Funnel / Event Analysis",
      intent: "Instrument and analyze a conversion funnel.",
      inputs: ["The flow", "Existing events/data", "The question to answer"],
      steps: [
        "Define the events and properties needed to measure the funnel.",
        "Validate data quality before drawing conclusions.",
        "Quantify drop-off at each step.",
        "Surface opportunities backed by the numbers.",
      ],
      deliverable: "A funnel analysis with drop-off and prioritized opportunities.",
      done: ["Events well-defined", "Data validated", "Drop-off + opportunities quantified"],
    }),
  },

  /* ───────────── Security (cross) ───────────── */
  {
    key: "sec-appsec-review",
    name: "Security — AppSec Review",
    description: "Review a change for OWASP-class issues: authz, injection, secrets, SSRF, data exposure.",
    layer: "cross",
    discipline: "security",
    markdown: body({
      title: "Security — AppSec Review",
      intent: "Review a change for application-security issues.",
      inputs: ["The diff/feature", "Trust boundaries + data sensitivity", "Auth model"],
      steps: [
        "Check authn/authz at every new boundary.",
        "Look for injection, SSRF, deserialization, and unsafe input handling.",
        "Verify secrets aren't logged/exposed and data exposure is minimized.",
        "Report findings by severity with concrete remediations.",
      ],
      deliverable: "An AppSec review with prioritized findings and fixes.",
      done: ["Authz checked", "OWASP-class issues assessed", "Findings + fixes by severity"],
    }),
  },
  {
    key: "sec-dependency-audit",
    name: "Security — Dependency Audit",
    description: "Audit dependencies for known CVEs; propose safe upgrades or mitigations.",
    layer: "cross",
    discipline: "security",
    markdown: body({
      title: "Security — Dependency Audit",
      intent: "Find and triage vulnerable dependencies.",
      inputs: ["The dependency manifest/lockfile", "Audit tooling output", "Risk tolerance"],
      steps: [
        "Run the audit and collect known CVEs with severity.",
        "Triage exploitability in this codebase's context.",
        "Propose upgrades or mitigations; note breaking risk.",
        "Document anything accepted with justification.",
      ],
      deliverable: "A triaged dependency audit with an upgrade/mitigation plan.",
      done: ["CVEs triaged by real risk", "Upgrade/mitigation plan", "Accepted risks justified"],
    }),
  },
  {
    key: "sec-pci-privacy",
    name: "Security — PCI / Privacy Review",
    description: "Review a payment/PII flow for PCI-DSS and privacy obligations; flag gaps and remediations.",
    layer: "cross",
    discipline: "security",
    markdown: body({
      title: "Security — PCI / Privacy Review",
      intent: "Review a payment or PII flow for compliance.",
      inputs: ["The flow + data it touches", "Applicable obligations (PCI-DSS, privacy law)", "Current controls"],
      steps: [
        "Map where cardholder/PII data flows and is stored.",
        "Minimize scope: avoid handling/storing sensitive data where possible.",
        "Check encryption, access control, retention, and logging against obligations.",
        "Flag gaps with concrete remediations.",
      ],
      deliverable: "A compliance review with mapped data flows and remediations.",
      done: ["Data flows mapped", "Scope minimized", "Gaps + remediations documented"],
    }),
  },
];

/** Sanity: keys must be unique. Thrown at import time if a duplicate slips in. */
const seen = new Set<string>();
for (const s of STANDARD_SKILLS) {
  if (seen.has(s.key)) throw new Error(`duplicate standard skill key: ${s.key}`);
  seen.add(s.key);
}
