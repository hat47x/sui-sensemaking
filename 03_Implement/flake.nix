{
  description = "sui-sensemaking project toolchain (Node 22, Python 3.12, Ruff)";

  # Single pinned input. The exact nixpkgs revision is locked in flake.lock so every
  # contributor and CI gets identical tool versions.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-24.11";

  outputs = { self, nixpkgs }:
    let
      # Systems we support a dev shell on (WSL2/Linux is x86_64-linux).
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };
    in
    {
      devShells = forSystems (system:
        let
          pkgs = pkgsFor system;
        in
        {
          # `nix develop` from the repo root drops you into this shell.
          default = pkgs.mkShell {
            # The single source of truth for the project's local toolchain.
            # - nodejs_22: matches frontend/Dockerfile (node:22-alpine); provides node/npm/npx.
            # - python312: matches backend/Dockerfile (python:3.12-slim); supports `python -m venv`.
            # - ruff: backend lint (`ruff check src tests`); also pinned in the backend test extra.
            # Docker is provided by the host (Docker Desktop / WSL integration), not here.
            # Playwright e2e needs extra browser setup; see 03_Implement/README.md.
            packages = [
              pkgs.nodejs_22
              pkgs.python312
              pkgs.ruff
            ];

            shellHook = ''
              echo "sui-sensemaking dev shell"
              echo "  node    $(node --version)"
              echo "  npm     $(npm --version)"
              echo "  python  $(python3 --version 2>&1)"
              echo "  ruff    $(ruff --version)"
            '';
          };
        });
    };
}
