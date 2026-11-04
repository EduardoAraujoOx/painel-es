"""Testes da redução da resposta da consulta pública de processos (edocs.py). Sem rede."""

import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("edocs", Path(__file__).resolve().parents[1] / "edocs.py")
E = importlib.util.module_from_spec(spec)
spec.loader.exec_module(E)

RESPOSTA = {"number": "2024-XM4CR", "parts": ["SEG - STD"], "subject": "Processo para Aquisição de Sistema de Informação Corporativo ou Próprio",
            "summary": "Processo de aquisição de   Plataforma\nde Portal", "status": "E-Docs", "district": "NAO INFORMADO", "extra": "", "pageUrl": "https://x",
            "updates": [{"date": "2025-08-28T16:00:00.000Z", "agency": "A", "area": "B", "status": "Autuação"},
                        {"date": "2025-09-16T09:55:00.000Z", "agency": "ASSESSOR", "area": "SUBSECRETARIA", "status": "Despacho"}]}


class Reducao(unittest.TestCase):
    def test_resumo_e_ultima_tramitacao(self):
        r = E.reduzir(RESPOSTA)
        self.assertEqual(r["assunto"], "Processo para Aquisição de Sistema de Informação Corporativo ou Próprio")
        self.assertEqual(r["resumo"], "Processo de aquisição de Plataforma de Portal")
        self.assertEqual((r["tramites"], r["ultima"]["data"], r["ultima"]["status"]), (2, "2025-09-16", "Despacho"))
        self.assertEqual(r["unidades"], ["SEG - STD"])

    def test_nao_guarda_campos_alem_do_resumo(self):
        self.assertFalse({"pageUrl", "district", "extra", "updates"} & set(E.reduzir(RESPOSTA)))

    def test_sem_historico(self):
        r = E.reduzir({"number": "x", "subject": "S", "updates": []})
        self.assertEqual((r["tramites"], r["ultima"]), (0, None))

    def test_resposta_vazia(self):
        r = E.reduzir({})
        self.assertEqual((r["assunto"], r["unidades"], r["ultima"]), ("", [], None))


if __name__ == "__main__":
    unittest.main()
