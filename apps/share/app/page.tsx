export const metadata = {
  title: "backstory — the prompts behind a PR",
};

export default function Home() {
  return (
    <main className="wrap landing">
      <div className="brand">backstory</div>
      <h1>The prompts behind a pull request.</h1>
      <p>
        Backstory traces the prompts you gave your coding agents to the commits, branches, and pull
        requests they produced. This is where shared links live — each one is an unguessable snapshot
        of the prompts behind a single PR.
      </p>
      <p style={{ marginTop: 20 }}>Create one from the CLI:</p>
      <pre>bs link 42</pre>
      <p>
        That publishes the prompts behind PR #42 and prints a link you can send to anyone — no account
        required. Learn more at{" "}
        <a href="https://github.com/nicolasmontone/backstory">github.com/nicolasmontone/backstory</a>.
      </p>
    </main>
  );
}
