/**
 * Login route loading fallback. The login page awaits the session check before
 * it can decide to render the form or redirect an already-signed-in user; this
 * paints the brand-dark background during that gap so a mode toggle / reload
 * never flashes a blank white page on the way in.
 */
export default function LoginLoading() {
  return (
    <div
      className="min-h-screen"
      style={{
        background:
          "radial-gradient(55% 55% at 18% 30%, rgba(226,35,26,0.30), transparent 60%)," +
          "linear-gradient(160deg, #15171e 0%, #0b0d12 58%, #070809 100%)",
      }}
    />
  );
}
