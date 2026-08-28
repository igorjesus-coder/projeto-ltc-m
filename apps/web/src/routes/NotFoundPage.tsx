import { ActionLink, PageHeader } from '../components/design-system';

export function NotFoundPage() {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <PageHeader
        eyebrow="Erro 404"
        title="Página não encontrada"
        titleId="not-found-title"
        description="O endereço informado não pertence ao scaffold atual do LTC-M."
      />
      <ActionLink variant="primary" href="/">
        Voltar para o início
      </ActionLink>
    </section>
  );
}
