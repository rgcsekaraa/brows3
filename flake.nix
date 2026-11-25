{
  description = "Brows3 desktop application and Linux development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/f4b794aaffc0e3d45da81088d492b118224bb476";
  inputs.rust-overlay.url = "github:oxalica/rust-overlay";
  inputs.rust-overlay.inputs.nixpkgs.follows = "nixpkgs";

  outputs = { nixpkgs, rust-overlay, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; overlays = [ rust-overlay.overlays.default ]; };
      inherit (pkgs) lib;
      manifest = lib.importJSON ./package.json;
      rust = pkgs.rust-bin.stable."1.97.1".minimal.override {
        extensions = [ "clippy" "rustfmt" ];
      };
      rustPlatform = pkgs.makeRustPlatform { cargo = rust; rustc = rust; };
      node = pkgs.nodejs_22;
      pnpm = pkgs.pnpm_11.override {
        version = lib.removePrefix "pnpm@" manifest.packageManager;
        hash = "sha512-NuZiH61QYXiTZFXnAke4gI707CV5ep9DepMoGgIEhOJgf2pGmiLpgph8PbuIZuMHFRSrEKShdJ4G7c0ewRhDbw==";
        nodejs-slim = node;
      };
      nativeLibraries = with pkgs; [
        gtk3 webkitgtk_4_1 libsoup_3 libayatana-appindicator librsvg
        openssl dbus libsecret
      ];
      buildTools = with pkgs; [ pkg-config perl cmake ];
      pnpmDeps = pkgs.fetchPnpmDeps {
        pname = "brows3";
        inherit pnpm;
        src = lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions [ ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ];
        };
        fetcherVersion = 5;
        # pnpm 11.2 keeps its verified lockfile record outside the dependency store.
        # Retain the content hash and policy, omitting machine-specific file metadata.
        postInstall = ''
          jq -ce '{lockfile: {hash: .lockfile.hash, path: "pnpm-lock.yaml"}, policy}' \
            "$HOME/.cache/pnpm/lockfile-verified.jsonl" > "$out/lockfile-verified.jsonl"
        '';
        hash = "sha256-X6mWXcJK0RNYTjIZIU9LNKP7LdxFUgyjF/YwUq09tc8=";
      };
      frontend = pkgs.stdenvNoCC.mkDerivation {
        pname = "brows3-frontend";
        inherit (manifest) version;
        src = ./.;
        inherit pnpmDeps;
        prePnpmInstall = ''
          mkdir -p "$HOME/.cache/pnpm"
          cp "${pnpmDeps}/lockfile-verified.jsonl" "$HOME/.cache/pnpm/"
        '';
        nativeBuildInputs = [ node pnpm pkgs.pnpmConfigHook ];
        NEXT_TELEMETRY_DISABLED = "1";
        buildPhase = ''
          runHook preBuild
          pnpm build
          runHook postBuild
        '';
        doCheck = true;
        checkPhase = ''
          runHook preCheck
          pnpm test
          pnpm typecheck
          pnpm lint --max-warnings 0
          runHook postCheck
        '';
        installPhase = "cp -r out $out";
      };
      brows3 = rustPlatform.buildRustPackage {
        pname = "brows3";
        inherit (manifest) version;
        src = ./src-tauri;
        cargoHash = "sha256-HTPk12a9XVuTxp6AV+pfqSPVH66OnY5OaDigiLWM3Xo=";
        nativeBuildInputs = buildTools ++ [ pkgs.wrapGAppsHook3 ];
        buildInputs = nativeLibraries;
        buildFeatures = [ "custom-protocol" ];
        preBuild = "ln -s ${frontend} ../out";
        passthru = { inherit frontend pnpmDeps; };
        meta.mainProgram = "brows3";
      };
    in {
      packages.${system} = { default = brows3; inherit frontend; };
      checks.${system} = { inherit frontend brows3; };
      devShells.${system} = rec {
        default = pkgs.mkShell {
          packages = buildTools ++ [ rust node pnpm pkgs.jq pkgs.patchelf ];
          buildInputs = nativeLibraries;
        };
        notebook = pkgs.mkShell {
          inputsFrom = [ default ];
          BROWS3_PROFILER_LIBRARY = "${pkgs.gperftools}/lib/libprofiler.so";
          packages = [
            pkgs.pprof pkgs.binutils
            (pkgs.python3.withPackages (ps: [ ps.jupyterlab ps.ipykernel ps.matplotlib ]))
          ];
        };
      };
    };
}
