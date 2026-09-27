// Plain (non-module) stylesheet imports. Next only ships types for `*.module.css`, and
// TypeScript rejects an unresolved side-effect import under moduleResolution: bundler.
declare module "*.css";
