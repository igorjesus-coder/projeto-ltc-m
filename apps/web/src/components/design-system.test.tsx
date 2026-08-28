import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  Breadcrumbs,
  Button,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from './design-system';

describe('design system P022', () => {
  it('renderiza navegação, cabeçalho e estado vazio com semântica própria', () => {
    const html = renderToStaticMarkup(
      <>
        <PageHeader
          title="Projetos"
          description="Consulte os projetos autorizados."
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: 'Início', href: '/' },
                { label: 'Projetos', current: true },
              ]}
            />
          }
        />
        <EmptyState title="Nenhum projeto" description="Ainda não há registros para exibir." />
      </>,
    );

    expect(html).toContain('aria-label="Trilha de navegação"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('Nenhum projeto');
    expect(html).toContain('aria-labelledby="empty-state-title"');
  });

  it('associa ajuda, erro e estados do campo ao controle', () => {
    const html = renderToStaticMarkup(
      <Field
        id="project-name"
        label="Nome do projeto"
        required
        help="Use o nome oficial."
        error="Campo obrigatório."
      >
        <Input name="projectName" />
      </Field>,
    );

    expect(html).toContain('for="project-name"');
    expect(html).toContain('id="project-name"');
    expect(html).toContain('name="projectName"');
    expect(html).toContain('required');
    expect(html).toContain('aria-describedby="project-name-help project-name-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
  });

  it('mantém props nativas nos controles e variantes pequenas do botão', () => {
    const html = renderToStaticMarkup(
      <>
        <Button variant="primary">Salvar</Button>
        <Button variant="danger" disabled>
          Excluir
        </Button>
        <Select aria-label="Status">
          <option value="active">Ativo</option>
        </Select>
        <Textarea aria-label="Descrição" />
      </>,
    );

    expect(html).toContain('button button-primary');
    expect(html).toContain('button button-danger');
    expect(html).toContain('disabled');
    expect(html).toContain('aria-label="Status"');
    expect(html).toContain('aria-label="Descrição"');
  });
});
