export function NotFoundPage() {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <p className="eyebrow">Erro 404</p>
      <h1 id="not-found-title">Página não encontrada</h1>
      <p>O endereço informado não pertence ao scaffold atual do LTC-M.</p>
      <a className="primary-link" href="/">
        Voltar para o início
      </a>
    </section>
  );
}
