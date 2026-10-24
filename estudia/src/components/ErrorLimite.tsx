import { Component, type ReactNode } from "react";

/** Si algo falla al pintar una pantalla, muestra un mensaje amable en lugar de una página en blanco. */
export class ErrorLimite extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-md p-8 text-center">
          <div className="text-5xl">🙈</div>
          <h1 className="mt-3 text-xl font-bold">Vaya, algo no ha ido bien</h1>
          <p className="mt-2 text-slate-600">Tus datos están a salvo. Recarga la página para seguir.</p>
          <button type="button" className="boton-primario mt-4" onClick={() => window.location.reload()}>
            Recargar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
