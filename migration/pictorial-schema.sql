-- ============================================================
-- Run this in your Supabase project SQL Editor
-- (Dashboard → SQL Editor → New Query)
-- ============================================================

-- ── pictorial_sections table ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pictorial_sections (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name           TEXT        NOT NULL DEFAULT 'Section 1',
  sort_order     INTEGER     NOT NULL DEFAULT 0,
  floor_plan_url TEXT,
  canvas_data    TEXT,
  deleted_at     TIMESTAMPTZ,
  created_by     UUID        REFERENCES public.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_pictorial_sections_updated_at ON public.pictorial_sections;
CREATE TRIGGER set_pictorial_sections_updated_at
  BEFORE UPDATE ON public.pictorial_sections
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────
ALTER TABLE public.pictorial_sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members view pictorial_sections"
  ON public.pictorial_sections FOR SELECT
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p
      JOIN public.users u ON u.organization_id = p.organization_id
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "org members insert pictorial_sections"
  ON public.pictorial_sections FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND project_id IN (
      SELECT p.id FROM public.projects p
      JOIN public.users u ON u.organization_id = p.organization_id
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "org members update pictorial_sections"
  ON public.pictorial_sections FOR UPDATE
  USING (
    project_id IN (
      SELECT p.id FROM public.projects p
      JOIN public.users u ON u.organization_id = p.organization_id
      WHERE u.id = auth.uid()
    )
  );

CREATE POLICY "creator delete pictorial_sections"
  ON public.pictorial_sections FOR DELETE
  USING (created_by = auth.uid());

-- ── Storage bucket for floor plan images ─────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('pictorial-images', 'pictorial-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "authenticated upload pictorial images"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'pictorial-images' AND auth.role() = 'authenticated');

CREATE POLICY "public view pictorial images"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'pictorial-images');

CREATE POLICY "authenticated update pictorial images"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'pictorial-images' AND auth.role() = 'authenticated');

CREATE POLICY "authenticated delete pictorial images"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'pictorial-images' AND auth.role() = 'authenticated');
